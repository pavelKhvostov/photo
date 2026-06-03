import SwiftUI
import SafariServices

// MARK: - PrivacyView

/// Экран приватности (152-ФЗ).
/// Содержит: ссылку на политику, кнопку «Удалить мои данные».
/// TODO: список согласий (GET /privacy/consents) и отзыв (POST /privacy/consent/:id/revoke).
struct PrivacyView: View {
    @Environment(AuthService.self) private var authService
    @State private var showPolicy = false
    @State private var showDeleteConfirm = false
    @State private var showLogoutConfirm = false

    var body: some View {
        ZStack {
            KadrTheme.background.ignoresSafeArea()

            List {
                // Политика
                Section {
                    Button {
                        showPolicy = true
                    } label: {
                        HStack {
                            Text("Политика обработки персональных данных")
                                .foregroundColor(KadrTheme.textPrimary)
                            Spacer()
                            Image(systemName: "arrow.up.right.square")
                                .foregroundColor(KadrTheme.textSecondary)
                        }
                    }
                } header: {
                    Text("Документы")
                        .foregroundColor(KadrTheme.textSecondary)
                }
                .listRowBackground(KadrTheme.surface)

                // Мои данные
                Section {
                    // TODO: список активных согласий (следующая фаза)
                    Label("Мои согласия", systemImage: "checkmark.shield")
                        .foregroundColor(KadrTheme.textSecondary)
                        .opacity(0.5)

                    Button {
                        showDeleteConfirm = true
                    } label: {
                        Label("Запрос на удаление данных", systemImage: "trash")
                            .foregroundColor(KadrTheme.error)
                    }
                } header: {
                    Text("Мои данные")
                        .foregroundColor(KadrTheme.textSecondary)
                } footer: {
                    Text("Удаление аккаунта и всех связанных данных. Обрабатывается в течение 30 дней согласно 152-ФЗ.")
                        .foregroundColor(KadrTheme.textDisabled)
                }
                .listRowBackground(KadrTheme.surface)

                // Выход
                Section {
                    Button {
                        showLogoutConfirm = true
                    } label: {
                        Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(KadrTheme.textSecondary)
                    }
                }
                .listRowBackground(KadrTheme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(KadrTheme.background)
        }
        .navigationTitle("Приватность")
        .sheet(isPresented: $showPolicy) {
            SafariView(url: AppConfig.privacyPolicyURL)
        }
        .alert("Запрос на удаление", isPresented: $showDeleteConfirm) {
            Button("Отправить запрос", role: .destructive) {
                // TODO: POST /privacy/deletion-request
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Мы обработаем ваш запрос в течение 30 дней и уведомим вас.")
        }
        .alert("Выйти?", isPresented: $showLogoutConfirm) {
            Button("Выйти", role: .destructive) {
                authService.logout()
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Вы выйдете из аккаунта хоста.")
        }
    }
}

// MARK: - SafariView

/// SFSafariViewController обёртка для показа политики приватности.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
