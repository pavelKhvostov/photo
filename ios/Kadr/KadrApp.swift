import SwiftUI

// MARK: - Точка входа

@main
struct KadrApp: App {
    /// AuthService — единственный источник состояния аутентификации.
    /// Передаётся как environment object через все экраны.
    @State private var authService = AuthService()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authService)
                .preferredColorScheme(.dark)  // плёночная тёмная тема
        }
    }
}
