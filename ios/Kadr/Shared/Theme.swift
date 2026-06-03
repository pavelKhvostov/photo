import SwiftUI

// MARK: - Тёмная плёночная тема «Кадр»

enum KadrTheme {
    // MARK: Цвета
    static let background      = Color(red: 0.08, green: 0.08, blue: 0.10)  // почти чёрный
    static let surface         = Color(red: 0.14, green: 0.13, blue: 0.15)  // тёмно-серый
    static let surfaceElevated = Color(red: 0.20, green: 0.19, blue: 0.22)

    static let accent          = Color(red: 0.95, green: 0.82, blue: 0.55)  // тёплый янтарь (плёнка)
    static let accentDim       = Color(red: 0.95, green: 0.82, blue: 0.55, opacity: 0.15)

    static let textPrimary     = Color(red: 0.96, green: 0.95, blue: 0.92)
    static let textSecondary   = Color(red: 0.60, green: 0.58, blue: 0.56)
    static let textDisabled    = Color(red: 0.35, green: 0.33, blue: 0.32)

    static let error           = Color(red: 0.90, green: 0.35, blue: 0.35)
    static let success         = Color(red: 0.35, green: 0.80, blue: 0.55)

    static let separator       = Color(white: 1.0, opacity: 0.08)

    // MARK: Радиусы
    static let cornerRadius: CGFloat = 12
    static let cornerRadiusLarge: CGFloat = 20

    // MARK: Отступы
    static let padding: CGFloat = 16
    static let paddingLarge: CGFloat = 24

    // MARK: Шрифты
    static let titleFont   = Font.system(size: 28, weight: .bold, design: .default)
    static let headingFont = Font.system(size: 20, weight: .semibold)
    static let bodyFont    = Font.system(size: 16, weight: .regular)
    static let captionFont = Font.system(size: 13, weight: .regular)
    static let labelFont   = Font.system(size: 15, weight: .medium)
}

// MARK: - ViewModifier для кнопки-акцента

struct AccentButtonStyle: ButtonStyle {
    var isEnabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(KadrTheme.labelFont)
            .foregroundColor(isEnabled ? KadrTheme.background : KadrTheme.textDisabled)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                    .fill(isEnabled ? KadrTheme.accent : KadrTheme.surfaceElevated)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - ViewModifier для карточки

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                    .fill(KadrTheme.surface)
            )
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}

// MARK: - Текстовое поле в стиле темы

struct KadrTextField: View {
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var isSecure: Bool = false

    var body: some View {
        Group {
            if isSecure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
                    .keyboardType(keyboardType)
            }
        }
        .font(KadrTheme.bodyFont)
        .foregroundColor(KadrTheme.textPrimary)
        .padding(KadrTheme.padding)
        .background(
            RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                .fill(KadrTheme.surface)
        )
        .tint(KadrTheme.accent)
    }
}

// MARK: - Индикатор загрузки

struct KadrProgressView: View {
    var body: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .tint(KadrTheme.accent)
    }
}

// MARK: - Плашка ошибки

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(KadrTheme.error)
            Text(message)
                .font(KadrTheme.captionFont)
                .foregroundColor(KadrTheme.textPrimary)
                .multilineTextAlignment(.leading)
            Spacer()
        }
        .padding(KadrTheme.padding)
        .background(
            RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                .fill(KadrTheme.error.opacity(0.15))
        )
    }
}
