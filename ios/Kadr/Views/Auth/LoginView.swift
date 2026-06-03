import SwiftUI

// MARK: - LoginView

/// Экран логина хоста.
/// Поддерживает два режима:
/// - .mock  → кнопка «Войти с тестовым токеном» (AppConfig.hostJWT)
/// - .otp   → ввод телефона → SMS-код
/// 152-ФЗ: чекбокс согласия на обработку ПДн обязателен, НЕ предзаполнен.
struct LoginView: View {
    @Environment(AuthService.self) private var authService

    // Локальное состояние формы (@Observable позволяет SwiftUI отслеживать изменения)
    @State private var phone: String = ""
    @State private var otpCode: String = ""
    @State private var isLoading: Bool = false
    @State private var otpSent: Bool = false
    @State private var errorMessage: String?
    /// 152-ФЗ: не предзаполнен — пользователь обязан явно поставить галочку
    @State private var consentChecked: Bool = false

    var body: some View {
        ZStack {
            KadrTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 32) {
                    headerSection
                    formSection
                    consentSection
                    actionsSection
                }
                .padding(KadrTheme.paddingLarge)
            }
        }
    }

    // MARK: - Заголовок

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.aperture")
                .font(.system(size: 56))
                .foregroundColor(KadrTheme.accent)

            Text("Кадр")
                .font(KadrTheme.titleFont)
                .foregroundColor(KadrTheme.textPrimary)

            Text("Событийная камера")
                .font(KadrTheme.bodyFont)
                .foregroundColor(KadrTheme.textSecondary)
        }
        .padding(.top, 40)
    }

    // MARK: - Форма

    @ViewBuilder
    private var formSection: some View {
        VStack(spacing: 16) {
            // Поле телефона — только в OTP-режиме (не в демо-режиме)
            if !AppConfig.useAnonymousHostLogin && (AppConfig.hostJWT.isEmpty || otpSent) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Номер телефона")
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textSecondary)

                    KadrTextField(
                        placeholder: "+7 900 000 00 00",
                        text: $phone,
                        keyboardType: .phonePad
                    )
                    .disabled(otpSent)
                }

                if otpSent {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Код из SMS")
                            .font(KadrTheme.captionFont)
                            .foregroundColor(KadrTheme.textSecondary)

                        KadrTextField(
                            placeholder: "000000",
                            text: $otpCode,
                            keyboardType: .numberPad
                        )
                    }
                }
            }

            if let error = errorMessage {
                ErrorBanner(message: error)
            }
        }
    }

    // MARK: - Согласие

    private var consentSection: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                consentChecked.toggle()
            } label: {
                Image(systemName: consentChecked ? "checkmark.square.fill" : "square")
                    .foregroundColor(consentChecked ? KadrTheme.accent : KadrTheme.textSecondary)
                    .font(.system(size: 22))
            }
            .buttonStyle(.plain)

            (
                Text("Согласен с ")
                    .foregroundColor(KadrTheme.textSecondary)
                +
                Text("политикой обработки персональных данных")
                    .foregroundColor(KadrTheme.accent)
                    .underline()
            )
            .font(KadrTheme.captionFont)
            .onTapGesture {
                UIApplication.shared.open(AppConfig.privacyPolicyURL)
            }

            Spacer()
        }
        .padding(KadrTheme.padding)
        .background(
            RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                .fill(KadrTheme.surface)
        )
    }

    // MARK: - Кнопки действий

    @ViewBuilder
    private var actionsSection: some View {
        VStack(spacing: 12) {
            // Демо-вход: анонимная сессия в роли хоста (локальная разработка)
            if AppConfig.useAnonymousHostLogin {
                Button("Войти (демо)") {
                    guard consentChecked else {
                        errorMessage = "Необходимо согласиться с политикой обработки персональных данных."
                        return
                    }
                    Task {
                        isLoading = true
                        errorMessage = nil
                        await authService.loginAnonymouslyForDemo()
                        isLoading = false
                        errorMessage = authService.errorMessage
                    }
                }
                .buttonStyle(AccentButtonStyle(isEnabled: consentChecked && !isLoading))
                .disabled(!consentChecked || isLoading)

                Text("Демо-режим (анонимный хост)")
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.textDisabled)

                if isLoading { KadrProgressView() }
            }

            // Mock-кнопка (только если hostJWT задан в AppConfig)
            if !AppConfig.hostJWT.isEmpty {
                Button("Войти с тестовым токеном") {
                    guard consentChecked else {
                        errorMessage = "Необходимо согласиться с политикой обработки персональных данных."
                        return
                    }
                    authService.loginWithMockToken()
                    errorMessage = authService.errorMessage
                }
                .buttonStyle(AccentButtonStyle(isEnabled: consentChecked))
                .disabled(!consentChecked)

                Text("Режим локальной разработки")
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.textDisabled)
            }

            // OTP-кнопки (если hostJWT пуст и демо-режим выключен)
            if AppConfig.hostJWT.isEmpty && !AppConfig.useAnonymousHostLogin {
                if !otpSent {
                    Button("Получить код") {
                        Task { await sendOTP() }
                    }
                    .buttonStyle(AccentButtonStyle(
                        isEnabled: consentChecked && !isLoading
                    ))
                    .disabled(!consentChecked || isLoading)
                } else {
                    Button("Войти") {
                        Task { await verifyOTP() }
                    }
                    .buttonStyle(AccentButtonStyle(
                        isEnabled: !otpCode.isEmpty && !isLoading
                    ))
                    .disabled(otpCode.isEmpty || isLoading)
                }

                if isLoading {
                    KadrProgressView()
                }
            }
        }
    }

    // MARK: - Действия OTP

    private func sendOTP() async {
        guard consentChecked else {
            errorMessage = "Необходимо согласиться с политикой обработки персональных данных."
            return
        }
        guard !phone.isEmpty else {
            errorMessage = "Введите номер телефона."
            return
        }
        isLoading = true
        errorMessage = nil
        await authService.requestOTP(phone: phone)
        isLoading = false
        if let err = authService.errorMessage {
            errorMessage = err
        } else {
            otpSent = true
        }
    }

    private func verifyOTP() async {
        guard !otpCode.isEmpty else {
            errorMessage = "Введите код из SMS."
            return
        }
        isLoading = true
        errorMessage = nil
        await authService.verifyOTP(phone: phone, code: otpCode)
        isLoading = false
        if let err = authService.errorMessage {
            errorMessage = err
        }
    }
}
