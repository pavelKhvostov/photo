import SwiftUI

// MARK: - MainTabView

/// Основная навигация после авторизации.
struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                EventsListView()
            }
            .tabItem {
                Label("События", systemImage: "camera.aperture")
            }

            NavigationStack {
                PrivacyView()
            }
            .tabItem {
                Label("Приватность", systemImage: "lock.shield")
            }
        }
        .tint(KadrTheme.accent)
        .background(KadrTheme.background)
    }
}
