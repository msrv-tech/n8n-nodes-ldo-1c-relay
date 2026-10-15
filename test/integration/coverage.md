# Матрица воспроизводимых проверок

Сгенерировано `python3 test/integration/coverage.py`. Это план покрытия,
а не результаты исполнения. Фактические статусы — в `report.json` и
[отчётах с версиями](../../docs/capabilities/README.md#доказательства-реальных-проверок).

Все 25 действий и 6 дополнительных возможностей имеют проверку.
24 standalone-действия исполняются настоящей нодой через n8n API/webhook.
Confirm PDF Delivery проверяется контрактно; live MSRV требует отдельного enrollment.

| ID реестра | Возможность | Серверный сценарий | Контрактная проверка |
| --- | --- | --- | --- |
| `get-capabilities` | Возможности подключённой базы | capabilities | [testCapabilitiesAndDynamicOptions](../nodes.test.cjs) |
| `get-document-fields` | Чтение документа | document-read | [testCapabilitiesAndDynamicOptions](../nodes.test.cjs) |
| `update-document-fields` | Изменение полей документа | document-write | [testDocumentFieldsUpdate](../nodes.test.cjs) |
| `get-catalog-fields` | Чтение элемента справочника | catalog-read | [testCatalogOperations](../nodes.test.cjs) |
| `update-catalog-fields` | Изменение элемента справочника | catalog-write | [testCatalogOperations](../nodes.test.cjs) |
| `search-reference-values` | Поиск значений ссылочного поля | reference-search | [testReferenceSelectionModes](../nodes.test.cjs) |
| `update-reference-field` | Изменение ссылочного поля | reference-write-three-modes | [testReferenceSelectionModes](../nodes.test.cjs) |
| `prepare-document-pdf` | PDF документа | pdf | [testPdfOperationAndFinalize](../nodes.test.cjs) |
| `start-external-process` | Запуск внешнего процесса | process-lifecycle | [testExternalProcessOperations](../nodes.test.cjs) |
| `get-external-process` | Состояние внешнего процесса | process-lifecycle | [testExternalProcessOperations](../nodes.test.cjs) |
| `transition-external-process` | Переход внешнего процесса | process-lifecycle | [testExternalProcessOperations](../nodes.test.cjs) |
| `update-external-process-fields` | Поля внешнего процесса | process-lifecycle | [testExternalProcessOperations](../nodes.test.cjs) |
| `cancel-external-process` | Отмена внешнего процесса | process-lifecycle | [testExternalProcessOperations](../nodes.test.cjs) |
| `lease-events` | Получение событий | event-document-ack | [testEventsAndRetry](../nodes.test.cjs) |
| `acknowledge-event` | Подтверждение события | event-document-ack | [testPdfOperationAndFinalize](../nodes.test.cjs) |
| `confirm-pdf-delivery` | Подтверждение доставки PDF | msrv-pdf-confirm (not-run without isolated enrollment) | [testPdfOperationAndFinalize](../nodes.test.cjs) |
| `retry-event` | Повтор события | event-document-ack | [testEventsAndRetry](../nodes.test.cjs) |
| `create-connection` | Создание своей очереди | connection-lifecycle, prepare-and-pair | [pairing scenarios](../pairing.test.cjs) |
| `connection-status` | Состояние подключения | connection-lifecycle | [pairing scenarios](../pairing.test.cjs) |
| `renew-pairing` | Новый код сопряжения | connection-lifecycle | [pairing scenarios](../pairing.test.cjs) |
| `disconnect-connection` | Отключение очереди | connection-lifecycle | [pairing scenarios](../pairing.test.cjs) |
| `get-queue-result` | Сохранённый результат команды | wait-result | [standalone scenarios](../standalone.test.cjs) |
| `clean-completed-entries` | Очистка завершённых записей | cleanup | [standalone scenarios](../standalone.test.cjs) |
| `search-documents` | Поиск документов | document-search, search-native-policy | [search scenarios](../search.test.cjs) |
| `search-catalog-items` | Поиск элементов справочников | catalog-search, search-native-policy | [search scenarios](../search.test.cjs) |
| `queue-gateway` | LDO 1C Queue Gateway Trigger | connection-lifecycle, prepare-and-pair | [standalone scenarios](../standalone.test.cjs) |
| `dynamic-policy` | Динамические разрешения | capabilities, access-isolation, search-native-policy | [testCapabilitiesAndDynamicOptions](../nodes.test.cjs) |
| `ai-tool` | Использование как инструмента AI-агента | ai-tool | [testExplicitMsrvVersionTwo](../nodes.test.cjs) |
| `wait-recovery` | Ожидание и восстановление | wait-result | [standalone scenarios](../standalone.test.cjs) |
| `write-receipts` | Повторы записи и версии | receipts | [standalone scenarios](../standalone.test.cjs) |
| `extension-distribution` | Отдельная поставка расширения 1С | prepare-and-pair, ordinary-event-onboarding | [pairing scenarios](../pairing.test.cjs) |

## Границы

- Queue-only сценарии в Direct имеют статус not-applicable, не PASS.
- Direct проверяет отказ по stale revision; явный повтор Command ID доступен в UI очереди.
- prepare-and-pair проверяет установленное расширение и native onboarding; не скачивание с сайта.
- PDF сравнивает binary output/метаданные; повреждённые байты отдельно проверяются контрактно.
- Wait не означает доказанный restart-контур: restart/аренды имеют отдельные контрактные/исторические проверки.
- AI требует реальную доступную модель; без неё статус not-run.
- Scheduler и интерфейс настройки не подменяются server PASS.
- Все бизнес-действия MSRV, Cloud и другие конфигурации требуют своих отдельных live-прогонов.
