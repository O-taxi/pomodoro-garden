import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ImageBackground, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { changePhase, DURATIONS, finish, formatTime, initialTimer, pause, secondsLeft, start, type Phase } from './src/timer';

const STORAGE_KEY = 'pomodoro-garden.preferences.v1';
const THEMES = [
  { id: 'forest', name: '深い森', colors: ['#244c42', '#101e1b'] as const, accent: '#c5e2b0' },
  { id: 'dusk', name: '夕暮れ', colors: ['#805950', '#251e31'] as const, accent: '#f4c7aa' },
  { id: 'ocean', name: '静かな海', colors: ['#31566e', '#111f32'] as const, accent: '#bbdce9' },
];
type TimerDesign = 'circle' | 'line';
type Background = { themeId: string; photoUri: string | null; usePhoto: boolean };
type BackgroundTarget = 'portrait' | 'landscape';
const defaultBackground = (): Background => ({ themeId: 'forest', photoUri: null, usePhoto: false });
function readBackground(value: unknown): Background {
  if (!value || typeof value !== 'object') return defaultBackground();
  const saved = value as Record<string, unknown>;
  const photoUri = typeof saved.photoUri === 'string' ? saved.photoUri : null;
  return {
    themeId: THEMES.some(theme => theme.id === saved.themeId) ? saved.themeId as string : 'forest',
    photoUri,
    usePhoto: photoUri !== null && saved.usePhoto === true,
  };
}
const BAR_COUNT = 60;

function TimeBars({ ratio, design, color }: { ratio: number; design: TimerDesign; color: string }) {
  const [size, setSize] = useState(280);
  const count = design === 'line' ? 30 : BAR_COUNT;
  const lit = Math.ceil(Math.max(0, Math.min(1, ratio)) * count);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={event => setSize(event.nativeEvent.layout.width)}
    style={design === 'circle' ? styles.ringBars : styles.lineBars}>
    {Array.from({ length: count }, (_, index) => {
      const angle = index * 360 / count;
      const radians = angle * Math.PI / 180;
      const radius = size / 2 - 14;
      return <View key={index} style={[design === 'circle' ? styles.ringBar : styles.lineBar,
        { backgroundColor: index < lit ? color : '#ffffff18' },
        design === 'circle' && { transform: [
          { translateX: Math.sin(radians) * radius - 2 },
          { translateY: -Math.cos(radians) * radius - 8 },
          { rotate: `${angle}deg` },
        ] },
      ]} />;
    })}
  </View>;
}

const PHASE_LABELS: Record<Phase, string> = { focus: '集中', shortBreak: '小休憩', longBreak: '長い休憩' };

function TimerScreen() {
  const [timer, setTimer] = useState(initialTimer);
  const [now, setNow] = useState(Date.now);
  const [backgrounds, setBackgrounds] = useState<Record<BackgroundTarget, Background>>({ portrait: defaultBackground(), landscape: defaultBackground() });
  const [backgroundTarget, setBackgroundTarget] = useState<BackgroundTarget>('portrait');
  const [timerDesign, setTimerDesign] = useState<TimerDesign>('circle');
  const isLinear = timerDesign === 'line';
  const orientationQueue = useRef(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timerSpace, setTimerSpace] = useState({ width: 300, height: 300 });
  const timerSize = Math.max(0, Math.min(300, timerSpace.width - 12, timerSpace.height - 12));
  const [photoBusy, setPhotoBusy] = useState(false);
  const mounted = useRef(true);
  const activeTarget: BackgroundTarget = isLinear ? 'landscape' : 'portrait';
  const { themeId, photoUri, usePhoto } = backgrounds[activeTarget];
  const editingBackground = backgrounds[backgroundTarget];
  const theme = THEMES.find(item => item.id === themeId) ?? THEMES[0];
  function updateBackground(patch: Partial<Background>) {
    setBackgrounds(current => ({ ...current, [backgroundTarget]: { ...current[backgroundTarget], ...patch } }));
  }
  const remaining = secondsLeft(timer, now);
  const running = timer.endsAt !== null;
  const remainingRatio = Math.max(0, Math.min(1, remaining / DURATIONS[timer.phase]));

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw || !mounted.current) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      const prefs = saved as Record<string, unknown>;
      if (prefs.timerDesign === 'circle' || prefs.timerDesign === 'line') setTimerDesign(prefs.timerDesign);
      if (prefs.backgrounds && typeof prefs.backgrounds === 'object') {
        const stored = prefs.backgrounds as Record<string, unknown>;
        setBackgrounds({ portrait: readBackground(stored.portrait), landscape: readBackground(stored.landscape) });
      } else {
        // 以前の共通背景を両方向に引き継ぎ、その後は別々に保存する。
        setBackgrounds({ portrait: readBackground(prefs), landscape: readBackground(prefs) });
      }
    }).catch(() => {
      if (mounted.current) Alert.alert('設定を読み込めませんでした', '初期設定で開きます。背景は選び直せます。');
    }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ backgrounds, timerDesign })).catch(() => {
      Alert.alert('設定を保存できませんでした', '次回起動時には背景を選び直してください。');
    });
  }, [ready, backgrounds, timerDesign]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    // 回転処理を順番に実行し、素早く切り替えても最後の選択に合わせる。
    orientationQueue.current = orientationQueue.current.then(() => ScreenOrientation.lockAsync(
      isLinear ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    )).catch(() => {
      if (active) Alert.alert('画面を回転できませんでした', '表示形式をもう一度選び直してください。');
    });
    return () => { active = false; };
  }, [ready, isLinear]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 250);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(interval); listener.remove(); };
  }, []);

  useEffect(() => {
    if (!running || remaining > 0 || AppState.currentState !== 'active') return;
    // 次の区間は自動開始しない。長時間閉じた場合に架空の集中回数を増やさないため。
    const next = finish(timer);
    setTimer(next);
    Vibration.vibrate([0, 180, 120, 180]);
    Alert.alert(timer.phase === 'focus' ? 'おつかれさまでした' : '休憩が終わりました', `次は${PHASE_LABELS[next.phase]}です。準備ができたら開始してください。`);
  }, [remaining, running, timer, now]);

  function reset() {
    const resetTimer = () => setTimer(current => changePhase(current, current.phase));
    if (running || remaining !== DURATIONS[timer.phase]) {
      Alert.alert('この区間をやり直しますか？', '残り時間を初期値に戻します。', [
        { text: '戻る', style: 'cancel' }, { text: 'リセット', onPress: resetTimer },
      ]);
    } else resetTimer();
  }

  function selectPhase(phase: Phase) {
    if (phase === timer.phase) return;
    const select = () => setTimer(current => changePhase(current, phase));
    if (running || remaining !== DURATIONS[timer.phase]) {
      Alert.alert('区間を切り替えますか？', '進行中の区間の残り時間はリセットされます。', [
        { text: '戻る', style: 'cancel' }, { text: '切り替える', onPress: select },
      ]);
    } else select();
  }

  async function choosePhoto() {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      // Androidのシステム写真ピッカーを使い、写真全体への権限は要求しない。
      // 縦横比を指定せず、Androidの切り取り画面で範囲を自由に調整する。
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (result.canceled) return;
      if (!FileSystem.documentDirectory) throw new Error('Document directory unavailable');
      const directory = `${FileSystem.documentDirectory}backgrounds/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const extension = result.assets[0].mimeType === 'image/png' ? 'png' : 'jpg';
      const destination = `${directory}photo-${Date.now()}.${extension}`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: destination });
      // キャッシュのURIをそのまま保存せず、アプリ専用領域へコピーする。
      const oldPhoto = editingBackground.photoUri;
      const nextBackgrounds = { ...backgrounds, [backgroundTarget]: { ...editingBackground, photoUri: destination, usePhoto: true } };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ backgrounds: nextBackgrounds, timerDesign }));
      setBackgrounds(nextBackgrounds);
      // 旧設定から引き継いだ写真を、もう一方の背景が使っていれば残す。
      if (oldPhoto?.startsWith(directory) && !Object.values(nextBackgrounds).some(background => background.photoUri === oldPhoto)) {
        FileSystem.deleteAsync(oldPhoto, { idempotent: true }).catch(() => {});
      }
    } catch {
      Alert.alert('写真を設定できませんでした', '別の写真を選ぶか、もう一度お試しください。');
    } finally { setPhotoBusy(false); }
  }

  const content = (
    <LinearGradient colors={['rgba(4,13,12,0.20)', 'rgba(4,13,12,0.76)']} style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <View style={[styles.page, isLinear && styles.landscapePage]}>
          <View style={styles.header}>
            <Text style={styles.brand}>POMODORO GARDEN</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="設定を開く" disabled={!ready} style={styles.settingsButton} onPress={() => { setBackgroundTarget(activeTarget); setPickerOpen(true); }}><Text style={styles.backgroundText}>⚙ 設定</Text></Pressable>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(Object.keys(PHASE_LABELS) as Phase[]).map(phase => (
              <Pressable key={phase} accessibilityRole="tab" accessibilityState={{ selected: timer.phase === phase }} onPress={() => selectPhase(phase)} style={[styles.tab, timer.phase === phase && styles.activeTab]}>
                <Text style={[styles.tabText, timer.phase === phase && styles.activeTabText]}>{PHASE_LABELS[phase]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.timerArea}>
            <View style={styles.timerStage} onLayout={event => { const { width, height } = event.nativeEvent.layout; setTimerSpace({ width, height }); }}>
            <View style={[styles.timerCircle, isLinear && styles.linearTimer, isLinear
              ? { width: Math.max(0, timerSpace.width - 12), height: Math.max(0, Math.min(240, timerSpace.height - 12)) }
              : { width: timerSize, height: timerSize }]}>
              {timerDesign === 'circle' && <TimeBars ratio={remainingRatio} design="circle" color={theme.accent} />}
              {isLinear && <TimeBars ratio={remainingRatio} design="line" color={theme.accent} />}
              <Text accessibilityLabel={`残り${Math.floor(remaining / 60)}分${remaining % 60}秒`} style={[styles.clock,
                { fontSize: isLinear ? Math.min(76, timerSpace.height * 0.48) : Math.min(68, timerSize * 0.23) },
                isLinear && styles.linearClock]} adjustsFontSizeToFit numberOfLines={1}>{formatTime(remaining)}</Text>
            </View>
            </View>
            <View style={[styles.controls, isLinear && styles.landscapeControls]}>
            <Pressable accessibilityRole="button" style={[styles.startButton, { backgroundColor: theme.accent }]} onPress={() => {
              const timestamp = Date.now(); setNow(timestamp);
              setTimer(current => {
                if (current.endsAt !== null && secondsLeft(current, timestamp) === 0) return current;
                return current.endsAt === null ? start(current, timestamp) : pause(current, timestamp);
              });
            }}><Text style={styles.startText}>{running ? 'Ⅱ  一時停止' : '▶  はじめる'}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={reset} style={styles.resetButton}><Text style={styles.resetText}>↻  リセット</Text></Pressable>
            </View>
          </View>
          <Text style={styles.completionCount}>集中 {timer.completed} 回完了</Text>
        </View>
      </SafeAreaView>
      <Modal supportedOrientations={['portrait', 'landscape']} visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="設定を閉じる" style={styles.backdrop} onPress={() => setPickerOpen(false)} />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={styles.sheetTitle}>設定</Text>
              <Text style={styles.backgroundText}>タイマーの表示</Text>
            <View style={styles.designSwitch} accessibilityRole="tablist">
              {(['circle', 'line'] as const).map(design => <Pressable key={design} disabled={!ready || photoBusy} accessibilityRole="tab" accessibilityState={{ selected: timerDesign === design }} onPress={() => setTimerDesign(design)} style={[styles.designOption, timerDesign === design && styles.designSelected]}>
                <Text style={styles.designLabel}>{design === 'circle' ? '◌ 円形' : '▥ 直線'}</Text>
              </Pressable>)}
            </View>
              <Text style={styles.backgroundText}>背景</Text>
              <View style={styles.designSwitch} accessibilityRole="tablist">
                {(['portrait', 'landscape'] as const).map(target => <Pressable key={target} disabled={photoBusy} accessibilityRole="tab" accessibilityState={{ selected: backgroundTarget === target }} onPress={() => setBackgroundTarget(target)} style={[styles.designOption, backgroundTarget === target && styles.designSelected]}>
                  <Text style={styles.designLabel}>{target === 'portrait' ? '縦画面用' : '横画面用'}</Text>
                </Pressable>)}
              </View>
              <Text style={styles.sheetDescription}>文字の読みやすさを保つため、写真には暗いフィルターが重なります。</Text>
              <View style={styles.themeRow}>{THEMES.map(item => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: !editingBackground.usePhoto && editingBackground.themeId === item.id }} style={[styles.themeOption, !editingBackground.usePhoto && editingBackground.themeId === item.id && styles.selectedTheme]} disabled={photoBusy} onPress={() => updateBackground({ themeId: item.id, usePhoto: false })}>
                  <LinearGradient colors={item.colors} style={styles.swatch}><Text style={styles.themeName}>{item.name}</Text></LinearGradient>
                </Pressable>
              ))}</View>
              <Text style={styles.sheetDescription}>写真を選んだあと、切り取り枠を動かして好きな範囲を選べます。背景は画面いっぱいに表示されるため、端が隠れることがあります。</Text>
              <Pressable accessibilityRole="button" disabled={photoBusy} onPress={choosePhoto} style={styles.photoButton}><Text style={styles.backgroundText}>{photoBusy ? '写真を選択・編集中…' : '＋ 写真を選んで切り取る'}</Text></Pressable>
              {editingBackground.photoUri && <Pressable accessibilityRole="button" disabled={photoBusy} onPress={() => updateBackground({ usePhoto: true })} style={styles.photoButton}><Text style={styles.backgroundText}>保存した写真を使う{editingBackground.usePhoto ? ' ✓' : ''}</Text></Pressable>}
              <Text style={styles.sheetDescription}>集中25分・小休憩5分・長い休憩15分（集中4回ごと）。時間は固定です。</Text>
              <Text style={styles.sheetDescription}>終了のお知らせは画面表示中のみ。アプリを終了するとタイマーと集中回数は初期化されます。</Text>
              <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={styles.resetButton}><Text style={styles.resetText}>閉じる</Text></Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </LinearGradient>
  );

  return <LinearGradient colors={theme.colors} style={styles.fill}>
    <StatusBar style="light" />
    {usePhoto && photoUri ? <ImageBackground source={{ uri: photoUri }} resizeMode="cover" style={styles.fill} onError={() => { setBackgrounds(current => current[activeTarget].photoUri === photoUri ? { ...current, [activeTarget]: { ...current[activeTarget], usePhoto: false } } : current); Alert.alert('写真を表示できませんでした', '背景の選択から写真を選び直してください。'); }}>{content}</ImageBackground> : content}
  </LinearGradient>;
}

export default function App() { return <SafeAreaProvider><TimerScreen /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, maxWidth: 520, width: '100%', alignSelf: 'center' },
  landscapePage: { maxWidth: 1100 },
  controls: { alignItems: 'center' },
  landscapeControls: { flexDirection: 'row', gap: 24 },
  timerStage: { flex: 1, minHeight: 0, width: '100%', alignItems: 'center', justifyContent: 'center' },
  settingsButton: { minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  completionCount: { color: '#c4d4c6', fontSize: 12, textAlign: 'center', paddingVertical: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  brand: { color: '#e8efe5', fontSize: 13, letterSpacing: 2.2, fontWeight: '600' },
  tabs: { flexDirection: 'row', padding: 5, borderRadius: 30, backgroundColor: '#ffffff10' },
  tab: { flex: 1, minHeight: 46, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: '#eaf1e7' },
  tabText: { color: '#d4dfd7', fontSize: 13 },
  activeTabText: { color: '#223b31', fontWeight: '700' },
  timerArea: { alignItems: 'center', flex: 1, minHeight: 0, paddingTop: 12 },
  designSwitch: { flexDirection: 'row', borderRadius: 22, padding: 4, backgroundColor: '#06120e99', alignSelf: 'flex-start', marginTop: 10, marginBottom: 22 },
  designOption: { paddingVertical: 9, paddingHorizontal: 22, borderRadius: 18 },
  designSelected: { backgroundColor: '#ffffff22' },
  designLabel: { color: '#e4eee1', fontSize: 12 },
  ringBars: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  ringBar: { position: 'absolute', left: '50%', top: '50%', width: 4, height: 16, borderRadius: 2 },
  lineBars: { flexDirection: 'row', flex: 1, gap: 4, alignSelf: 'stretch', margin: 12 },
  lineBar: { flex: 1, borderRadius: 2 },
  linearTimer: { flexDirection: 'row', borderRadius: 20, borderColor: '#ffffff30', backgroundColor: '#06120e88', padding: 4 },
  timerCircle: { borderWidth: 2, borderRadius: 180, alignItems: 'center', justifyContent: 'center', backgroundColor: '#06120e22' },
  clock: { color: '#f8fbf4', fontSize: 68, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -2, marginVertical: 8, width: '88%', textAlign: 'center' },
  linearClock: { width: '26%', marginHorizontal: 8, letterSpacing: -1 },
  startButton: { marginTop: 8, borderRadius: 32, minHeight: 52, minWidth: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  startText: { color: '#223729', fontWeight: '700', fontSize: 16 },
  resetButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  resetText: { color: '#c7d4c8', fontSize: 13 },
  backgroundText: { color: '#e4eee1', fontSize: 14 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000099' },
  sheet: { backgroundColor: '#1a2e26', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%' },
  sheetContent: { padding: 24 },
  sheetTitle: { color: '#f0f5eb', fontSize: 23, marginBottom: 12, fontWeight: '600' },
  sheetDescription: { color: '#c3d0c4', fontSize: 12, lineHeight: 21 },
  themeRow: { flexDirection: 'row', gap: 10, marginVertical: 22 },
  themeOption: { flex: 1, borderWidth: 2, borderColor: 'transparent', padding: 3, borderRadius: 17 },
  selectedTheme: { borderColor: '#c5e2b0' },
  swatch: { height: 100, borderRadius: 12, justifyContent: 'flex-end', padding: 8 },
  themeName: { color: '#ffffff', fontSize: 12 },
  photoButton: { borderWidth: 1, borderColor: '#ffffff30', borderRadius: 16, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 12, paddingHorizontal: 12 },
});
