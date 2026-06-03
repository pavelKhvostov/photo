import SwiftUI

// MARK: - EventCardView

/// Карточка события в списке «Мои события».
struct EventCardView: View {
    let event: Event

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title)
                        .font(KadrTheme.headingFont)
                        .foregroundColor(KadrTheme.textPrimary)
                        .lineLimit(2)

                    Text(event.cameraStyle.displayName)
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textSecondary)
                }
                Spacer()

                statusBadge
            }

            HStack(spacing: 16) {
                Label(Self.dateFormatter.string(from: event.createdAt),
                      systemImage: "calendar")
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.textSecondary)

                Spacer()

                Text(event.plan.displayName)
                    .font(KadrTheme.captionFont)
                    .foregroundColor(KadrTheme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(KadrTheme.accentDim))
            }

            if let revealAt = event.revealAt {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11))
                        .foregroundColor(KadrTheme.textSecondary)
                    Text("Проявка: \(Self.dateFormatter.string(from: revealAt))")
                        .font(KadrTheme.captionFont)
                        .foregroundColor(KadrTheme.textSecondary)
                }
            }
        }
        .padding(KadrTheme.padding)
        .cardStyle()
        .overlay(
            RoundedRectangle(cornerRadius: KadrTheme.cornerRadius)
                .stroke(KadrTheme.separator, lineWidth: 1)
        )
    }

    // MARK: - Статус-бейдж

    private var statusBadge: some View {
        Text(event.status.displayName)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(statusColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(statusColor.opacity(0.15)))
    }

    private var statusColor: Color {
        switch event.status {
        case .live:     return KadrTheme.success
        case .revealed: return KadrTheme.accent
        case .draft:    return KadrTheme.textSecondary
        case .archived, .deleted: return KadrTheme.error
        }
    }
}
