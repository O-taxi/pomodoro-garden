import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ImageBackground, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
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
const PHASE_LABELS: Record<Phase, string> = { focus: '集中', shortBreak: '小休憩', longBreak: '長い休憩' };

function TimerScreen() {
  const [timer, setTimer] = useState(initialTimer);
  const [now, setNow] = useState(Date.now);
  const [themeId, setThemeId] = useState('forest');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [usePhoto, setUsePhoto] = useState(false);
  const [ready, setReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const mounted = useRef(true);
  const theme = THEMES.find(item => item.id === themeId) ?? THEMES[0];
  const remaining = secondsLeft(timer, now);
  const running = timer.endsAt !== null;

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw || !mounted.current) return;
      const saved: unknown = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      const prefs = saved as Record<string, unknown>;
      if (typeof prefs.themeId === 'string' && THEMES.some(item => item.id === prefs.themeId)) setThemeId(prefs.themeId);
      if (typeof prefs.photoUri === 'string') {
        setPhotoUri(prefs.photoUri);
        setUsePhoto(prefs.usePhoto === true);
      }
    }).catch(() => {
      if (mounted.current) Alert.alert('設定を読み込めませんでした', '初期設定で開きます。背景は選び直せます。');
    }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ themeId, photoUri, usePhoto })).catch(() => {
      Alert.alert('設定を保存できませんでした', '次回起動時には背景を選び直してください。');
    });
  }, [ready, themeId, photoUri, usePhoto]);

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
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
      if (result.canceled) return;
      if (!FileSystem.documentDirectory) throw new Error('Document directory unavailable');
      const directory = `${FileSystem.documentDirectory}backgrounds/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const extension = result.assets[0].mimeType === 'image/png' ? 'png' : 'jpg';
      const destination = `${directory}photo-${Date.now()}.${extension}`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: destination });
      // キャッシュのURIをそのまま保存せず、アプリ専用領域へコピーする。
      const oldPhoto = photoUri;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ themeId, photoUri: destination, usePhoto: true }));
      setPhotoUri(destination);
      setUsePhoto(true);
      if (oldPhoto?.startsWith(directory)) FileSystem.deleteAsync(oldPhoto, { idempotent: true }).catch(() => {});
    } catch {
      Alert.alert('写真を設定できませんでした', '別の写真を選ぶか、もう一度お試しください。');
    } finally { setPhotoBusy(false); }
  }

  const content = (
    <LinearGradient colors={['rgba(4,13,12,0.20)', 'rgba(4,13,12,0.76)']} style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.header}>
            <View><Text style={styles.brand}>POMODORO GARDEN</Text><Text style={styles.tagline}>ひと区切りずつ、育てよう。</Text></View>
            <Text style={styles.leaf} accessibilityLabel="葉っぱ">❧</Text>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(Object.keys(PHASE_LABELS) as Phase[]).map(phase => (
              <Pressable key={phase} accessibilityRole="tab" accessibilityState={{ selected: timer.phase === phase }} onPress={() => selectPhase(phase)} style={[styles.tab, timer.phase === phase && styles.activeTab]}>
                <Text style={[styles.tabText, timer.phase === phase && styles.activeTabText]}>{PHASE_LABELS[phase]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.timerArea}>
            <Text style={styles.eyebrow}>{running ? (timer.phase === 'focus' ? 'いまは、目の前のひとつに。' : '肩の力を抜いて、ひと休み。') : '自分のペースで、はじめよう。'}</Text>
            <View style={[styles.timerCircle, { borderColor: `${theme.accent}60` }]}>
              <Text style={styles.phaseLabel}>{PHASE_LABELS[timer.phase]}の時間</Text>
              <Text accessibilityLabel={`残り${Math.floor(remaining / 60)}分${remaining % 60}秒`} style={styles.clock} adjustsFontSizeToFit numberOfLines={1}>{formatTime(remaining)}</Text>
              <Text style={styles.stateLabel}>{running ? 'タイマー実行中' : remaining === DURATIONS[timer.phase] ? 'READY TO BEGIN' : '一時停止中'}</Text>
            </View>
            <Pressable accessibilityRole="button" style={[styles.startButton, { backgroundColor: theme.accent }]} onPress={() => {
              const timestamp = Date.now(); setNow(timestamp);
              setTimer(current => {
                if (current.endsAt !== null && secondsLeft(current, timestamp) === 0) return current;
                return current.endsAt === null ? start(current, timestamp) : pause(current, timestamp);
              });
            }}><Text style={styles.startText}>{running ? 'Ⅱ  一時停止' : '▶  はじめる'}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={reset} style={styles.resetButton}><Text style={styles.resetText}>↻  リセット</Text></Pressable>
          </View>
          <View style={styles.footer}>
            <View style={styles.sessionCard}>
              <Text style={styles.sectionLabel}>この起動中の集中</Text>
              <Text style={styles.count}>{timer.completed}<Text style={styles.countUnit}> 回完了</Text></Text>
              <Text style={styles.small}>集中4回ごとに、15分の長い休憩。</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={!ready} style={styles.backgroundButton} onPress={() => setPickerOpen(true)}><Text style={styles.backgroundText}>▧  背景を変える</Text></Pressable>
            <Text style={styles.notice}>試作版：終了のお知らせは画面を開いている間に表示します。{ '\n' }アプリを終了するとタイマーと集中回数は初期化されます。</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="背景選択を閉じる" style={styles.backdrop} onPress={() => setPickerOpen(false)} />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={styles.sheetTitle}>気分に合う背景を。</Text>
              <Text style={styles.sheetDescription}>文字の読みやすさを保つため、写真には暗いフィルターが重なります。</Text>
              <View style={styles.themeRow}>{THEMES.map(item => (
                <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: !usePhoto && themeId === item.id }} style={[styles.themeOption, !usePhoto && themeId === item.id && styles.selectedTheme]} onPress={() => { setThemeId(item.id); setUsePhoto(false); }}>
                  <LinearGradient colors={item.colors} style={styles.swatch}><Text style={styles.themeName}>{item.name}</Text></LinearGradient>
                </Pressable>
              ))}</View>
              <Pressable accessibilityRole="button" disabled={photoBusy} onPress={choosePhoto} style={styles.photoButton}><Text style={styles.backgroundText}>{photoBusy ? '写真を保存中…' : '＋ スマホの写真を選ぶ'}</Text></Pressable>
              {photoUri && <Pressable accessibilityRole="button" onPress={() => setUsePhoto(true)} style={styles.photoButton}><Text style={styles.backgroundText}>保存した写真を使う{usePhoto ? ' ✓' : ''}</Text></Pressable>}
              <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={styles.resetButton}><Text style={styles.resetText}>閉じる</Text></Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </LinearGradient>
  );

  return <LinearGradient colors={theme.colors} style={styles.fill}>
    <StatusBar style="light" />
    {usePhoto && photoUri ? <ImageBackground source={{ uri: photoUri }} resizeMode="cover" style={styles.fill} onError={() => { setUsePhoto(false); Alert.alert('写真を表示できませんでした', '背景の選択から写真を選び直してください。'); }}>{content}</ImageBackground> : content}
  </LinearGradient>;
}

export default function App() { return <SafeAreaProvider><TimerScreen /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 20, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 34 },
  brand: { color: '#e8efe5', fontSize: 13, letterSpacing: 2.2, fontWeight: '600' },
  tagline: { color: '#bacbc0', fontSize: 12, marginTop: 8 },
  leaf: { color: '#c5e2b0', fontSize: 38 },
  tabs: { flexDirection: 'row', padding: 5, borderRadius: 30, backgroundColor: '#ffffff10' },
  tab: { flex: 1, minHeight: 46, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: '#eaf1e7' },
  tabText: { color: '#d4dfd7', fontSize: 13 },
  activeTabText: { color: '#223b31', fontWeight: '700' },
  timerArea: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 30, paddingBottom: 12 },
  eyebrow: { color: '#d0ddd0', fontSize: 13, marginBottom: 24, textAlign: 'center' },
  timerCircle: { width: '88%', maxWidth: 300, aspectRatio: 1, borderWidth: 2, borderRadius: 180, alignItems: 'center', justifyContent: 'center', backgroundColor: '#06120e22' },
  phaseLabel: { color: '#c6d6c7', fontSize: 13, letterSpacing: 2 },
  clock: { color: '#f8fbf4', fontSize: 68, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -2, marginVertical: 8, width: '88%', textAlign: 'center' },
  stateLabel: { color: '#becfbd', fontSize: 10, letterSpacing: 2 },
  startButton: { marginTop: 28, borderRadius: 32, minHeight: 58, minWidth: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  startText: { color: '#223729', fontWeight: '700', fontSize: 16 },
  resetButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  resetText: { color: '#c7d4c8', fontSize: 13 },
  footer: { paddingTop: 14 },
  sessionCard: { backgroundColor: '#ffffff0b', borderWidth: 1, borderColor: '#ffffff16', borderRadius: 20, padding: 18 },
  sectionLabel: { color: '#c4d4c6', fontSize: 12 },
  count: { color: '#f0f5eb', fontSize: 28, marginTop: 6, fontWeight: '500' },
  countUnit: { color: '#c4d4c6', fontSize: 12, fontWeight: '400' },
  small: { color: '#b0c3b6', fontSize: 11, marginTop: 6, lineHeight: 18 },
  backgroundButton: { minHeight: 52, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  backgroundText: { color: '#e4eee1', fontSize: 14 },
  notice: { color: '#a4b5a8', fontSize: 10, lineHeight: 17, textAlign: 'center' },
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
