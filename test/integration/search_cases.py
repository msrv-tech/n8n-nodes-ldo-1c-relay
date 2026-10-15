"""Live searches execute actual n8n nodes; fixtures alone name UNF metadata."""
from __future__ import annotations
from datetime import datetime,timedelta


def params(kind,object_type,filters,**extra):
    return {'searchObjectType':object_type,'searchFilters':{'conditions':filters},
        'searchResultMode':'list','searchReturnAll':False,'searchLimit':20,'searchCursor':'',**extra}


def filter(field,value,match='exact',to=''):
    return {'field':field,'value':value,'match':match,'to':to}


def document_search(h,mode):
    native=h.read(mode);number=native['values']['number'];day=native['values']['date'][:10]
    conditions=[filter('number',number),filter('date',day)]
    if h.state['fixture'].get('searchOrganization'):conditions.append(filter('organization',h.state['fixture']['searchOrganization']))
    p=params('document','document.СчетНаОплату',conditions,searchResultMode='single')
    search=h.action('Search','operation','documentSearch',p,mode)
    read=h.action('Read found document','operation','documentGet',{'documentType':'={{$json.object.type}}',
        'documentId':'={{$json.object.id}}','fields':['number','date']},mode)
    result=h.invoke([search,read],pump=mode=='queue')
    assert result[0]['object']['id']==h.state['fixture']['document']
    assert result[0]['values']['number']==number and '0' in number
    # Seek pagination and inclusive calendar boundary: only the two same-day invoices.
    prefix=h.state['fixture']['searchPrefix']
    p=params('document','document.СчетНаОплату',[filter('number',prefix,'startsWith'),filter('date',day)],searchLimit=1)
    first=h.run('operation','documentSearch',p,mode)
    assert first['_ldo']['search']['has_more']
    second=h.run('operation','documentSearch',{**p,'searchCursor':first['_ldo']['search']['next_cursor']},mode)
    ids={first['object']['id'],second['object']['id']}
    assert ids=={h.state['fixture']['document'],h.state['fixture']['searchDocuments'][0]}
    assert not second['_ldo']['search']['has_more']
    all_items=h.invoke([h.action('All documents','operation','documentSearch',{**p,'searchReturnAll':True},mode)],pump=mode=='queue')
    assert {v['object']['id'] for v in all_items}==ids
    wrong=h.run('operation','documentSearch',{**p,'searchCursor':first['_ldo']['search']['next_cursor']+'x'},mode,negative=True)
    assert 'error' in wrong
    ambiguous=h.run('operation','documentSearch',{**p,'searchResultMode':'single'},mode,negative=True)
    assert 'error' in ambiguous
    empty=h.run('operation','documentSearch',params('document','document.СчетНаОплату',[filter('number',prefix+'999')]),mode)
    assert not empty
    bad_date=h.run('operation','documentSearch',params('document','document.СчетНаОплату',[filter('date','2026-02-30')]),mode,negative=True)
    assert 'error' in bad_date
    broad=h.run('operation','documentSearch',params('document','document.СчетНаОплату',[filter('date',day,'between',(datetime.fromisoformat(day)+timedelta(days=40)).date().isoformat())]),mode,negative=True)
    assert 'error' in broad


def catalog_search(h,mode):
    native=h.run('operation','catalogGet',{'catalogType':'catalog.Сотрудники','catalogId':h.state['fixture']['catalog'],'catalogFields':['name','code']},mode)
    p=params('catalog','catalog.Сотрудники',[filter('name',native['values']['name'])],searchResultMode='single')
    search=h.action('Search','operation','catalogSearch',p,mode)
    read=h.action('Read found catalog item','operation','catalogGet',{'catalogType':'={{$json.object.type}}',
        'catalogId':'={{$json.object.id}}','catalogFields':['name','code']},mode)
    result=h.invoke([search,read],pump=mode=='queue')
    assert result[0]['object']['id']==h.state['fixture']['catalog']
    p=params('catalog','catalog.Сотрудники',[filter('name',h.state['marker'],'contains')],searchReturnAll=True)
    values=h.invoke([h.action('All catalogs','operation','catalogSearch',p,mode)],pump=mode=='queue')
    assert {v['object']['id'] for v in values}=={h.state['fixture']['catalog'],*h.state['fixture']['searchCatalogs']}
    ambiguous=h.run('operation','catalogSearch',{**p,'searchResultMode':'single'},mode,negative=True)
    assert 'error' in ambiguous
    # taxNumber is a local policy mapping, not a hardcoded INN field in the node/handler.
    taxpayer=h.run('operation','catalogSearch',params('catalog','catalog.Контрагенты',[filter('taxNumber','7707083893'),filter('name',h.state['marker'],'startsWith')],searchResultMode='single'),mode)
    assert taxpayer['object']['id']==h.state['fixture']['contractor']
    refused=h.run('operation','catalogSearch',params('catalog','catalog.Сотрудники',[filter('sql','SELECT *')]),mode,negative=True)
    assert 'error' in refused
    too_short=h.run('operation','catalogSearch',params('catalog','catalog.Сотрудники',[filter('name','x','contains')]),mode,negative=True)
    assert 'error' in too_short
    empty=h.run('operation','catalogSearch',params('catalog','catalog.Сотрудники',[filter('name',h.state['marker']+' nonexistent')]),mode)
    assert not empty


def search_policy_guards(h,mode):
    # Bypass client-side filter checks to exercise the native trust boundary itself.
    code = """Ч=Новый ЧтениеJSON; Ч.УстановитьСтроку(Параметры[0]); Payload=ПрочитатьJSON(Ч); НС=Справочники.ЛДО_Настройки.Выбрать(); НС.Следующий(); Н=НС.НастройкиАвтоматизации.Получить(); П=Неопределено; Для Каждого П1 Из Н.ПрофилиN8N Цикл Если П1.profile_id=Параметры[1] Тогда П=П1; КонецЕсли; КонецЦикла; Попытка ЛДО_АвтоматизацияСервер.НайтиОбъектыN8N(Payload,П,"catalog"); РезультатВыполнения="unexpected-success"; Исключение РезультатВыполнения=СтрНайти(ОписаниеОшибки(),"filter_not_allowed")>0; КонецПопытки;"""
    import json
    bad={'object_type':'catalog.Сотрудники','filters':[{'field':'Наименование; SELECT','match':'exact','value':'x'}],'limit':20,'cursor':'','result_mode':'list'}
    assert h.bridge.bsl(code,[json.dumps(bad),h.state['fixture']['profile']['profile_id']]) is True
    # The supplied native profile has no search grant, despite ordinary read access.
    code = """Ч=Новый ЧтениеJSON; Ч.УстановитьСтроку(Параметры[0]); Payload=ПрочитатьJSON(Ч); П=Новый Структура("grants",Новый Массив); Попытка ЛДО_АвтоматизацияСервер.НайтиОбъектыN8N(Payload,П,"catalog"); РезультатВыполнения=Ложь; Исключение РезультатВыполнения=СтрНайти(ОписаниеОшибки(),"access_denied")>0; КонецПопытки;"""
    good={**bad,'filters':[{'field':'name','match':'exact','value':h.state['marker']}]}
    assert h.bridge.bsl(code,[json.dumps(good)]) is True
