// Типы маршрутов React Navigation

export type RootStackParamList = {
  Login: undefined;
  Events: undefined;
  CreateEvent: undefined;
  QR: {
    joinUrl: string;
    eventId: string;
    eventTitle: string;
  };
  Gallery: {
    eventId: string;
    revealAt: string | null;
  };
};
