import SwiftUI

// MARK: - CreateEventView

/// Экран создания события.
/// Форма: название, стиль камеры, лимит кадров, дата проявки, дата начала, согласие.
struct CreateEventView: View {
    @Environment(\.dismiss) private var dismiss

    // Поля формы как plain @State — чисто и без сложностей с @Bindable передачей
    @State private var title: String = ""
    @State private var cameraStyle: CameraStyle = .film35
    @State private var shotsPerGuest: Int = 20
    @State private var revealAtEnabled: Bool = false
    @State private var revealAt: Date = Date().addingTimeInterval(3600)
    @State private var startsAtEnabled: Bool = false
    @State private var startsAt: Date = Date()
    /// 152-ФЗ: согласие, не предзаполнено
    @State private var consentChecked: Bool = false

    @State private var isLoading: Bool = false
    @State private var errorMessage: String?
    @State private var showQR: Bool = false
    @State private var createdJoinUrl: String = ""
    @State private var createdShortCode: String = ""

    // MARK: Валидация

    private var canCreate: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
        && title.count <= 120
        && consentChecked
        && !isLoading
    }

    private var titleError: String? {
        guard !title.isEmpty else { return nil }
        if title.count > 120 { return "Не более 120 символов" }
        return nil
    }

    var body: some View {
        NavigationStack {
            ZStack {
                KadrTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        titleField
                        cameraStylePicker
                        shotLimitSection
                        startsAtSection
                        revealAtSection
                        consentSection

                        if let error = errorMessage {
                            ErrorBanner(message: error)
                        }

                        createButton
                    }
                    .padding(KadrTheme.padding)
                }
            }
            .navigationTitle("Новое событие")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                        .foregroundColor(KadrTheme.textSecondary)
                }
            }
            .sheet(isPresented: $showQR) {
                QRShareView(joinUrl: createdJoinUrl, shortCode: createdShortCode)
            }
        }
    }

    // MARK: - Название

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Название события")
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textSecondary)

            KadrTextField(placeholder: "Свадьба Ани и Пети", text: $title)

            if let error = titleError {
                Text(error)
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.error)
            }
        }
    }

    // MARK: - Стиль камеры

    private var cameraStylePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Стиль камеры")
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textSecondary)

            Picker("Стиль камеры", selection: $cameraStyle) {
                ForEach(CameraStyle.allCases) { style in
                    Text(style.displayName).tag(style)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    // MARK: - Лимит кадров

    private var shotLimitSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Кадров на гостя: \(shotsPerGuest)")
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textSecondary)

            HStack {
                Button {
                    if shotsPerGuest > 1 { shotsPerGuest -= 1 }
                } label: {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(shotsPerGuest > 1 ? KadrTheme.accent : KadrTheme.textDisabled)
                }
                .buttonStyle(.plain)

                Spacer()

                Text("\(shotsPerGuest)")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundColor(KadrTheme.textPrimary)
                    .frame(minWidth: 60)

                Spacer()

                Button {
                    if shotsPerGuest < 1000 { shotsPerGuest += 1 }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(shotsPerGuest < 1000 ? KadrTheme.accent : KadrTheme.textDisabled)
                }
                .buttonStyle(.plain)
            }
            .padding(KadrTheme.padding)
            .cardStyle()
        }
    }

    // MARK: - Дата начала

    private var startsAtSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Дата начала")
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.textSecondary)
                Spacer()
                Toggle("", isOn: $startsAtEnabled)
                    .tint(KadrTheme.accent)
                    .labelsHidden()
            }

            if startsAtEnabled {
                DatePicker("", selection: $startsAt, displayedComponents: [.date, .hourAndMinute])
                    .datePickerStyle(.compact)
                    .labelsHidden()
                    .tint(KadrTheme.accent)
                    .environment(\.locale, Locale(identifier: "ru_RU"))
            }
        }
        .padding(KadrTheme.padding)
        .cardStyle()
    }

    // MARK: - Дата проявки

    private var revealAtSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Дата проявки")
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textSecondary)
                    Text("Когда гости увидят общую галерею")
                        .font(.system(size: 11))
                        .foregroundColor(KadrTheme.textDisabled)
                }
                Spacer()
                Toggle("", isOn: $revealAtEnabled)
                    .tint(KadrTheme.accent)
                    .labelsHidden()
            }

            if revealAtEnabled {
                DatePicker(
                    "", selection: $revealAt,
                    in: Date()...,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(KadrTheme.accent)
                .environment(\.locale, Locale(identifier: "ru_RU"))
            }
        }
        .padding(KadrTheme.padding)
        .cardStyle()
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
        .cardStyle()
    }

    // MARK: - Кнопка создания

    private var createButton: some View {
        VStack(spacing: 8) {
            Button("Создать событие") {
                Task { await createEvent() }
            }
            .buttonStyle(AccentButtonStyle(isEnabled: canCreate))
            .disabled(!canCreate)

            if isLoading {
                KadrProgressView()
            }
        }
    }

    // MARK: - Действие

    private func createEvent() async {
        guard canCreate else {
            if !consentChecked {
                errorMessage = "Необходимо согласиться с политикой обработки персональных данных."
            }
            return
        }
        isLoading = true
        errorMessage = nil

        let request = CreateEventRequest(
            title: title.trimmingCharacters(in: .whitespaces),
            cameraStyle: cameraStyle.rawValue,
            shotsPerGuest: shotsPerGuest,
            revealAt: revealAtEnabled ? revealAt : nil,
            startsAt: startsAtEnabled ? startsAt : nil
        )

        do {
            let response = try await APIClient.shared.createEvent(request)
            createdJoinUrl = response.joinUrl
            createdShortCode = response.shortCode
            isLoading = false
            showQR = true
        } catch {
            errorMessage = (error as? KadrError)?.userMessage ?? error.localizedDescription
            isLoading = false
        }
    }
}
