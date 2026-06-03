import SwiftUI

// MARK: - RootView

/// Маршрутизация: показываем LoginView или основной интерфейс в зависимости от auth-состояния.
struct RootView: View {
    @Environment(AuthService.self) private var authService

    var body: some View {
        Group {
            if authService.isAuthenticated {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .background(KadrTheme.background.ignoresSafeArea())
    }
}
