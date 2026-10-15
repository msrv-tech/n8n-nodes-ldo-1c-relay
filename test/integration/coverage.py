#!/usr/bin/env python3
"""Generate/check coverage obligations against the authoritative capability registry.

This is a plan matrix, never a claim that a live test passed. The runner's
report.json and versioned evidence hold execution results.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from cases import SCENARIOS

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = {
    "get-capabilities": "testCapabilitiesAndDynamicOptions",
    "get-document-fields": "testCapabilitiesAndDynamicOptions",
    "update-document-fields": "testDocumentFieldsUpdate",
    "get-catalog-fields": "testCatalogOperations",
    "update-catalog-fields": "testCatalogOperations",
    "search-reference-values": "testReferenceSelectionModes",
    "update-reference-field": "testReferenceSelectionModes",
    "prepare-document-pdf": "testPdfOperationAndFinalize",
    "start-external-process": "testExternalProcessOperations",
    "get-external-process": "testExternalProcessOperations",
    "transition-external-process": "testExternalProcessOperations",
    "update-external-process-fields": "testExternalProcessOperations",
    "cancel-external-process": "testExternalProcessOperations",
    "lease-events": "testEventsAndRetry",
    "acknowledge-event": "testPdfOperationAndFinalize",
    "confirm-pdf-delivery": "testPdfOperationAndFinalize",
    "retry-event": "testEventsAndRetry",
    "dynamic-policy": "testCapabilitiesAndDynamicOptions",
    "ai-tool": "testExplicitMsrvVersionTwo",
}
SEARCH = {"search-documents", "search-catalog-items"}
PAIRING = {"create-connection", "connection-status", "renew-pairing",
           "disconnect-connection", "extension-distribution"}
STANDALONE = {"get-queue-result", "clean-completed-entries", "queue-gateway",
              "wait-recovery", "write-receipts"}
EXTRA = [
    ("prepare-and-pair", ["create-connection", "queue-gateway", "extension-distribution"]),
    ("ordinary-event-onboarding", ["extension-distribution"]),
    ("msrv-pdf-confirm (not-run without isolated enrollment)", ["confirm-pdf-delivery"]),
]


def generate():
    registry=json.loads((ROOT/"docs/capabilities/registry.json").read_text())
    entries=registry["operations"]+registry["features"]
    ids={entry["id"] for entry in entries}
    scenarios=[(id,coverage) for id,fn,coverage in SCENARIOS]+EXTRA
    assert len({id for id,fn,coverage in SCENARIOS})==len(SCENARIOS), "Duplicate scenario ID"
    assert all(callable(fn) for id,fn,coverage in SCENARIOS), "Uncallable scenario"
    covered={id for case,coverage in scenarios for id in coverage}
    assert covered==ids, "Capability coverage differs: "+str(sorted(covered^ids))
    assert set(CONTRACTS)|PAIRING|STANDALONE|SEARCH==ids, "Missing contract mapping"
    text=(ROOT/"test/nodes.test.cjs").read_text()
    assert all("function "+fn+"(" in text for fn in CONTRACTS.values()), "Missing contract test"
    result=["# Матрица воспроизводимых проверок", "",
        "Сгенерировано `python3 test/integration/coverage.py`. Это план покрытия,",
        "а не результаты исполнения. Фактические статусы — в `report.json` и",
        "[отчётах с версиями](../../docs/capabilities/README.md#доказательства-реальных-проверок).", "",
        "Все 25 действий и 6 дополнительных возможностей имеют проверку.",
        "24 standalone-действия исполняются настоящей нодой через n8n API/webhook.",
        "Confirm PDF Delivery проверяется контрактно; live MSRV требует отдельного enrollment.", "",
        "| ID реестра | Возможность | Серверный сценарий | Контрактная проверка |",
        "| --- | --- | --- | --- |"]
    for entry in entries:
        id=entry["id"]
        live=", ".join(case for case,coverage in scenarios if id in coverage)
        file="search" if id in SEARCH else "nodes" if id in CONTRACTS else "pairing" if id in PAIRING else "standalone"
        label=CONTRACTS.get(id,file+" scenarios")
        result.append(f"| `{id}` | {entry['title']} | {live} | [{label}](../{file}.test.cjs) |")
    result += ["", "## Границы", "",
        "- Queue-only сценарии в Direct имеют статус not-applicable, не PASS.",
        "- Direct проверяет отказ по stale revision; явный повтор Command ID доступен в UI очереди.",
        "- prepare-and-pair проверяет установленное расширение и native onboarding; не скачивание с сайта.",
        "- PDF сравнивает binary output/метаданные; повреждённые байты отдельно проверяются контрактно.",
        "- Wait не означает доказанный restart-контур: restart/аренды имеют отдельные контрактные/исторические проверки.",
        "- AI требует реальную доступную модель; без неё статус not-run.",
        "- Scheduler и интерфейс настройки не подменяются server PASS.",
        "- Все бизнес-действия MSRV, Cloud и другие конфигурации требуют своих отдельных live-прогонов.", ""]
    return "\n".join(result)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check",action="store_true")
    args=parser.parse_args()
    matrix=Path(__file__).with_name("coverage.md")
    expected=generate()
    if args.check:
        assert matrix.exists() and matrix.read_text()==expected, "Coverage matrix stale; run coverage.py"
    else:matrix.write_text(expected)
    print("Coverage obligations: all 25 actions and 6 features mapped; "+("checked" if args.check else "generated"))


if __name__=="__main__":main()
