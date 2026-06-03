import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { signInAnonymously, setAuthToken } from '../api';
import { theme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [agreed, setAgreed] = useState(false); // 152-ФЗ: чекбокс НЕ предзаполнен
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!agreed) return;
    setLoading(true);
    try {
      const token = await signInAnonymously();
      setAuthToken(token);
      navigation.replace('Events');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      Alert.alert('Ошибка входа', message);
    } finally {
      setLoading(false);
    }
  }

  function openPolicy() {
    // Политика конфиденциальности (заглушка-ссылка для разработки)
    Linking.openURL('https://kadr.ru/privacy').catch(() => {
      Alert.alert('Ошибка', 'Не удалось открыть политику конфиденциальности');
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Логотип */}
        <View style={styles.logoBlock}>
          <Text style={styles.logoText}>Кадр</Text>
          <Text style={styles.tagline}>Событийная камера</Text>
        </View>

        {/* Описание */}
        <View style={styles.descBlock}>
          <Text style={styles.descText}>
            Создавайте события, делитесь QR-кодом с гостями и получайте общую
            галерею в «плёночном» стиле — без установки приложений для гостей.
          </Text>
        </View>

        {/* Согласие (152-ФЗ): чекбокс не предзаполнен */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setAgreed((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>
            Я принимаю{' '}
            <Text style={styles.link} onPress={openPolicy}>
              политику обработки персональных данных
            </Text>{' '}
            и даю согласие на обработку данных в соответствии с 152-ФЗ
          </Text>
        </TouchableOpacity>

        {/* Кнопка входа */}
        <TouchableOpacity
          style={[styles.button, (!agreed || loading) && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={!agreed || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={theme.colors.background} />
          ) : (
            <Text style={styles.buttonText}>Войти (демо)</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          На продакшне — вход по номеру телефона (SMS OTP)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xxl,
    paddingBottom: theme.spacing.xl,
    justifyContent: 'center',
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  logoText: {
    fontSize: 52,
    fontWeight: '700',
    color: theme.colors.accent,
    letterSpacing: 4,
  },
  tagline: {
    fontSize: theme.font.sizes.md,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
    letterSpacing: 1,
  },
  descBlock: {
    marginBottom: theme.spacing.xl,
  },
  descText: {
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  checkmark: {
    color: theme.colors.background,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: theme.font.sizes.sm,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  link: {
    color: theme.colors.accent,
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: theme.font.sizes.md,
    fontWeight: '700',
    color: theme.colors.background,
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: theme.font.sizes.xs,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});
