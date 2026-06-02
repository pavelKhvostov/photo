import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Политика обработки персональных данных — Кадр',
}

/**
 * Страница политики обработки персональных данных.
 *
 * TODO: Финальный текст политики согласовывается специалистом по персональным данным
 * и юристом. Текст ниже — плейсхолдер для MVP. До публичного запуска заменить
 * актуальным документом, прошедшим проверку на соответствие 152-ФЗ.
 * Уведомление в РКН должно быть подано до начала обработки ПДн.
 */
export default function PrivacyPage() {
  return (
    <main className="page">
      <div style={{ width: '100%', maxWidth: '640px' }}>
        <div className="app-brand" style={{ textAlign: 'left', marginBottom: '24px' }}>
          Кадр
        </div>

        <h1 style={{ marginBottom: '8px' }}>
          Политика обработки персональных данных
        </h1>
        <p
          className="text-muted"
          style={{ marginBottom: '32px', fontSize: '0.875rem' }}
        >
          Редакция от 01 июня 2026 г.
        </p>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '16px',
            marginBottom: '32px',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: 'var(--accent)', lineHeight: '1.6' }}>
            <strong>Внимание:</strong> Данный текст является временным плейсхолдером.
            Финальная редакция политики согласовывается со специалистом по персональным
            данным. Не является юридически обязывающим документом в настоящей редакции.
          </p>
        </div>

        <div className="stack-lg" style={{ fontSize: '0.95rem', lineHeight: '1.7' }}>
          <section>
            <h2 style={{ marginBottom: '12px' }}>1. Оператор</h2>
            <p className="text-muted">
              [Полное наименование организации / ИП], место нахождения: [адрес в РФ].
              Контактный адрес для обращений субъектов ПДн: [email].
            </p>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>2. Какие данные мы обрабатываем</h2>
            <ul
              className="text-muted"
              style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <li>Имя (псевдоним), указанное при вступлении в событие</li>
              <li>Фотографии, сделанные через камеру устройства</li>
              <li>Технические данные: IP-адрес, User-Agent (для записи согласия)</li>
              <li>
                Анонимный идентификатор сессии (не связан с реальной личностью
                без дополнительной идентификации)
              </li>
            </ul>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>3. Цели обработки</h2>
            <ul
              className="text-muted"
              style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <li>Организация совместной фотосъёмки на событии (photo_upload)</li>
              <li>Предоставление сервиса (service)</li>
            </ul>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>4. Хранение и безопасность</h2>
            <p className="text-muted">
              Все данные хранятся исключительно на серверах в Российской Федерации
              (Yandex Cloud / VK Cloud) в соответствии со ст. 18.1 ч. 5 Федерального
              закона № 152-ФЗ «О персональных данных». Применяется шифрование данных
              при хранении и передаче (TLS). Фотографии доступны только по
              временным подписанным ссылкам с ограниченным сроком действия.
            </p>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>5. Сроки хранения</h2>
            <p className="text-muted">
              Фотографии и данные события хранятся в течение срока, определённого
              тарифным планом (от 7 до 365 дней). По истечении срока данные
              автоматически и безвозвратно удаляются.
            </p>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>6. Ваши права (ст. 14–17 152-ФЗ)</h2>
            <ul
              className="text-muted"
              style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              <li>Право на доступ к своим персональным данным</li>
              <li>Право на исправление неточных данных</li>
              <li>Право на удаление данных (отзыв согласия)</li>
              <li>Право на ограничение обработки</li>
            </ul>
            <p className="text-muted" style={{ marginTop: '12px' }}>
              Для реализации прав обратитесь по адресу: [email]. Отзыв согласия влечёт
              удаление всех ваших фотографий из системы.
            </p>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>7. Передача третьим лицам</h2>
            <p className="text-muted">
              Данные не передаются третьим лицам, за исключением случаев, предусмотренных
              законодательством РФ. Трансграничная передача осуществляется только в
              отношении push-уведомлений iOS (Apple APNs) в объёме, минимально
              необходимом для доставки уведомления.
            </p>
          </section>

          <section>
            <h2 style={{ marginBottom: '12px' }}>8. Нет распознавания лиц</h2>
            <p className="text-muted">
              Сервис не использует технологии распознавания, идентификации или
              биометрической обработки лиц (ст. 11 152-ФЗ).
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
