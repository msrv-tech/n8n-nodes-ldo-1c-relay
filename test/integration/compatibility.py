#!/usr/bin/env python3
"""Node/core smoke for any registered 1C adapter; metadata names are fixture inputs.

Uses the installed node through n8n Public API/webhooks. No product code is
copied. Previous 1C settings are restored; only owned fixtures are removed.
"""
import argparse
import json
import os
from pathlib import Path
import time
from client import Bridge
from harness import Harness


class CompatibilityBridge(Bridge):
    def __init__(self, database, config):
        super().__init__(database)
        self.config = config

    def fixture(self, name, params=None):
        if name == 'prepare.bsl':
            params = [params[0], self.config['documentMetadata'], self.config['catalogMetadata']]
        return super().fixture('compatibility-' + name, params)


def exercise(h, mode):
    f = h.state['fixture']
    caps = h.run('operation', 'capabilities', mode=mode)
    assert all(kind + '.search' in caps['operations'] for kind in ['document', 'catalog'])
    for kind in ['document', 'catalog']:
        field, value = ('number', f['number']) if kind == 'document' else ('name', f['name'])
        search = h.action('Find ' + kind, 'operation', kind + 'Search', {
            'searchObjectType': f[kind + 'Type'], 'searchResultMode': 'single',
            'searchFilters': {'conditions': [{'field': field, 'match': 'exact', 'value': value, 'to': ''}]},
            'searchLimit': 20, 'searchReturnAll': False, 'searchCursor': '',
        }, mode)
        read_params = ({'documentType': '={{$json.object.type}}', 'documentId': '={{$json.object.id}}', 'fields': ['number', 'date']}
                       if kind == 'document' else
                       {'catalogType': '={{$json.object.type}}', 'catalogId': '={{$json.object.id}}', 'catalogFields': ['name']})
        result = h.invoke([search, h.action('Read ' + kind, 'operation', kind + 'Get', read_params, mode)], pump=mode == 'queue')
        assert result[0]['object']['id'] == f[kind]
        assert result[0]['values'][field] == value
        if kind == 'document':
            changed = h.run('operation', 'documentFieldsUpdate', {
                'writeDocumentType': f['documentType'], 'writeDocumentId': f['document'],
                'expectedDocumentRevision': result[0]['revision'], 'documentChanges': '{"comment": "' + h.state['marker'] + ' changed"}',
            }, mode)
            assert changed.get('revision') and changed['object']['id'] == f['document']
            # Independent server assertion, separate from the node response.
            assert h.bridge.bsl('С=Документы[Параметры[0]].ПолучитьСсылку(Новый УникальныйИдентификатор(Параметры[1])); РезультатВыполнения=С.Комментарий;',
                [h.config['documentMetadata'], f['document']]) == h.state['marker'] + ' changed'
    # Native permission enforcement, without relying on the node's UI validation.
    refused = h.bridge.bsl('Н=Справочники.ЛДО_Настройки.Выбрать(); Н.Следующий(); С=Н.НастройкиАвтоматизации.Получить(); П=Неопределено; Для Каждого П1 Из С.ПрофилиN8N Цикл Если П1.profile_id=Параметры[0] Тогда П=П1; КонецЕсли; КонецЦикла; Ф=Новый Массив; Ф.Добавить(Новый Структура("field,match,value","unknown_sql_field","exact","x")); Вход=Новый Структура("object_type,filters,limit,cursor,result_mode",Параметры[1],Ф,20,"","list"); Попытка ЛДО_АвтоматизацияСервер.НайтиОбъектыN8N(Вход,П,"catalog"); РезультатВыполнения=Ложь; Исключение РезультатВыполнения=СтрНайти(ОписаниеОшибки(),"filter_not_allowed")>0; КонецПопытки;',
        [f['profile']['profile_id'], f['catalogType']])
    assert refused is True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--allow-writes', action='store_true')
    parser.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    if not args.allow_writes:
        parser.error('--allow-writes required for disposable registered demo fixtures')
    config = json.loads(Path(args.config).read_text())
    config['apiKey'] = os.environ[config.get('n8nApiKeyEnv', 'LDO_TEST_N8N_API_KEY')]
    h = Harness(config, args.output, resume=args.cleanup)
    h.bridge = CompatibilityBridge(h.db, config)
    if args.cleanup:
        h.cleanup()
        print('Compatibility fixture recovery passed')
        return 0
    started = time.monotonic()
    report = {'nodeVersion': config['nodePackageVersion'], 'coreVersion': config['coreVersion'], 'modes': {}}
    try:
        initial = h.preflight()
        versions = [e["version"] for e in initial["installedExtensions"] if e["name"] in ["ЛДО", "ЛегкийДокументооборотДляУНФ"]]
        assert len(versions) == 1 and versions[0].split(".")[:2] == config["coreVersion"].split(".")
        h.prepare()
        for mode in config.get('modes', ['queue', 'direct']):
            h.mode(mode)
            exercise(h, mode)
            report['modes'][mode] = 'passed'
            print(mode + ': search → read → update and policy guard passed', flush=True)
    finally:
        h.cleanup()
        report['cleanup'] = 'passed'
        report['seconds'] = round(time.monotonic() - started, 2)
        Path(args.output, 'compatibility-report.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
