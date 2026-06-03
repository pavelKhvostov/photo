import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './src/navigation/types';
import LoginScreen from './src/screens/LoginScreen';
import EventsScreen from './src/screens/EventsScreen';
import CreateEventScreen from './src/screens/CreateEventScreen';
import QRScreen from './src/screens/QRScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Навигационная тема: тёмная плёночная палитра
const navTheme = {
  dark: true,
  colors: {
    primary: theme.colors.accent,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    notification: theme.colors.accent,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '800' as const },
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerShown: false, // кастомные шапки в каждом экране
            contentStyle: { backgroundColor: theme.colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Events" component={EventsScreen} />
          <Stack.Screen name="CreateEvent" component={CreateEventScreen} />
          <Stack.Screen name="QR" component={QRScreen} />
          <Stack.Screen name="Gallery" component={GalleryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
