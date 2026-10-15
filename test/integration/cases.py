"""Executable scenarios, not tests of copied production implementation."""
from __future__ import annotations
import json
import uuid


class NotAvailable(RuntimeError):
    pass


class NotRun(RuntimeError):
    pass


def capabilities(h, mode):
    value=h.run('operation','capabilities',mode=mode)
    kinds={o['object_type'] for o in value['object_types']}
    assert {'document.СчетНаОплату','catalog.Сотрудники'} <= kinds
    assert any(p['id']==h.state['fixture']['processProfile'] for p in value['process_profiles'])


def document_read(h, mode):
    value=h.read(mode)
    assert value['object']['id']==h.state['fixture']['document']
    assert set(value['values'])=={'number','date'}
    assert value['revision']==h.document()['revision']


def write_params(h, mode, marker=None):
    return {'writeDocumentType':'document.СчетНаОплату','writeDocumentId':h.state['fixture']['document'],
            'expectedDocumentRevision':h.read(mode)['revision'],
            'documentChanges':json.dumps({'comment':marker or h.state['marker']+' updated'})}


def document_write(h, mode):
    value=h.run('operation','documentFieldsUpdate',write_params(h,mode),mode)
    actual=h.document()
    assert actual['comment']==h.state['marker']+' updated'
    assert actual['revision']==value['revision'] and actual['posted'] is False


def catalog_read(h, mode):
    value=h.run('operation','catalogGet',{'catalogType':'catalog.Сотрудники',
        'catalogId':h.state['fixture']['catalog'],'catalogFields':['name','code']},mode)
    assert value['object']['id']==h.state['fixture']['catalog']
    assert value['values']['name'].startswith(h.state['marker'])


def catalog_write(h, mode):
    read=h.run('operation','catalogGet',{'catalogType':'catalog.Сотрудники',
        'catalogId':h.state['fixture']['catalog'],'catalogFields':['name','code']},mode)
    marker='CAP '+h.state['marker'][-8:]
    value=h.run('operation','catalogFieldsUpdate',{'writeCatalogType':'catalog.Сотрудники',
        'writeCatalogId':h.state['fixture']['catalog'],'expectedCatalogRevision':read['revision'],
        'catalogChanges':json.dumps({'note':marker})},mode)
    actual=h.bridge.bsl('О=Справочники.Сотрудники.ПолучитьСсылку(Новый УникальныйИдентификатор(Параметры[0])).ПолучитьОбъект(); РезультатВыполнения=Новый Структура("name,revision",О.УточнениеНаименования,Строка(О.ВерсияДанных));',[h.state['fixture']['catalog']])
    assert actual=={'name':marker,'revision':value['revision']}


def references(h, mode):
    value=h.run('operation','referenceSearch',{'referenceObjectType':'document.СчетНаОплату',
        'referenceFieldId':'responsible','referenceQuery':h.state['marker']+' Employee','referenceLimit':20},mode)
    assert len(value['items'])==1 and value['items'][0]['id']==h.state['fixture']['catalog']


def reference_write(h, mode):
    for source in ['id','live','cache']:
        params={'referenceObjectType':'document.СчетНаОплату','referenceFieldId':'responsible',
            'referenceOwnerId':h.state['fixture']['document'],'referenceOwnerRevision':h.read(mode)['revision'],
            'referenceValueMode':source,'referenceValueId':h.state['fixture']['catalog'],
            'referenceLiveQuery':h.state['marker']+' Employee','referenceCachedId':h.state['fixture']['catalog']}
        result=h.run('operation','referenceFieldUpdate',params,mode)
        assert result['_ldo']['reference']['id']==h.state['fixture']['catalog']
        assert h.document()['responsible']==h.state['fixture']['catalog']


def process(h, mode):
    fixture=h.state['fixture']
    start=h.run('operation','processStart',{'processProfileId':fixture['processProfile'],
        'processDocumentType':'document.СчетНаОплату','processDocumentId':fixture['document']},mode)
    id=start['process_id'];h.state['processes'].append(id);h.save()
    assert start['status']=='draft' and start['revision']==1
    before=h.document()
    update=h.run('operation','processFieldsUpdate',{'processProfileId':fixture['processProfile'],
        'processId':id,'expectedRevision':1,'processValues':json.dumps({'note':'checked'})},mode)
    assert update['values']['note']=='checked'
    transition=h.run('operation','processTransition',{'processProfileId':fixture['processProfile'],
        'processId':id,'expectedRevision':update['revision'],'transitionId':'review','processValues':'{}'},mode)
    assert transition['status']=='review'
    read=h.run('operation','processGet',{'processId':id},mode)
    assert read['revision']==transition['revision']
    cancelled=h.run('operation','processCancel',{'processId':id,'expectedRevision':read['revision']},mode)
    assert cancelled['active'] is False
    native=h.bridge.bsl('М=РегистрыСведений.ЛДО_ЭкземплярыВнешнихПроцессов.СоздатьМенеджерЗаписи(); М.ИдентификаторПроцесса=Параметры[0]; М.Прочитать(); РезультатВыполнения=Новый Структура("active,revision",М.Активен,М.Версия);',[id])
    assert native['revision']==cancelled['revision'] and native['active'] is False
    assert h.document()==before, 'Process-local writes modified document'


def events(h, mode):
    if mode!='queue':raise NotAvailable('Direct events use outgoing webhook; queue resource intentionally unavailable')
    assert h.preflight()['captureEnabled'], 'Pairing did not enable native event capture'
    h.approve(h.state['fixture']['document'])
    h.bridge.bsl('ЛДО_АвтоматизацияСервер.ОпросКомандАвтоматизации(); РезультатВыполнения=Истина;')
    leased=h.run('events',params={'eventTypes':['approval.started'],'limit':1})
    assert leased.get('payload',{}).get('object',{}).get('id')==h.state['fixture']['document']
    token=leased['_ldo']['lease_token'];event=leased['_ldo']['event_id']
    retry=h.run('finalize','fail',{'eventId':event,'leaseToken':token,'error':'Fixture retry','retryAfterSeconds':0})
    assert retry['status']=='retry_scheduled'
    # No document UUID is set in these business nodes: it is an expression from the event.
    receive=h.action('Events','events',None,{'eventTypes':['approval.started'],'limit':1})
    read=h.action('Read from event','operation','documentGet',{
        'documentType':'={{$json.payload.object.type}}','documentId':'={{$json.payload.object.id}}','fields':['number','date']})
    ack=h.action('Acknowledge','finalize','event',{'eventId':'={{$("Events").item.json._ldo.event_id}}',
        'leaseToken':'={{$("Events").item.json._ldo.lease_token}}'})
    output=h.invoke([receive,read,ack])
    assert output[0]['status']=='acknowledged'
    again=h.run('events',params={'eventTypes':['approval.started'],'limit':1})
    assert not again, 'Acknowledged event was delivered again'
    h.state['eventWorkflow']=h.state['workflows'][-2];h.save()


def pdf(h, mode):
    if not h.state['fixture']['pdfDocument'] or not h.state['fixture']['forms']:
        raise NotRun('No populated PDF template or native print form in demo')
    assert h.preflight()['captureEnabled'], 'Pairing did not enable native event capture'
    h.approve(h.state['fixture']['pdfDocument'],True)
    revision=h.read(mode,pdf=True)['revision']
    result=h.run('operation','documentFilePrepare',{'documentType':'document.СчетНаОплату',
        'documentId':h.state['fixture']['pdfDocument'],'formId':h.state['fixture']['forms'][0],'revision':revision},mode)
    assert len(result['sha256'])==64 and result['size_bytes']>1000
    # PDF bytes are verified by the actual node; metadata alone is not an independent byte assertion.
    executions=h.n8n.api('GET','/executions?workflowId='+h.state['workflows'][-1]+'&limit=1')['data']
    execution=h.n8n.api('GET','/executions/'+str(executions[0]['id'])+'?includeData=true')
    outputs=execution['data']['resultData']['runData']['Action'][-1]['data']['main'][0]
    assert outputs[0].get('binary',{}).get('data'), 'No binary output in actual execution'


def wait_result(h, mode):
    if mode!='queue':raise NotAvailable('Retained result API is standalone queue only')
    command=str(uuid.uuid4())
    queued=h.run('operation','documentGet',{'documentType':'document.СчетНаОплату',
        'documentId':h.state['fixture']['document'],'fields':['number','date'],'waitForResult':False,'commandId':command},pump=False)
    assert queued['status']=='queued'
    wait={'id':str(uuid.uuid4()),'name':'Wait','type':'n8n-nodes-base.wait','typeVersion':1.1,
          'position':[600,300],'parameters':{'resume':'timeInterval','amount':2,'unit':'seconds'}}
    lookup=h.action('Result','queue','getResult',{'queuedCommandId':command})
    result=h.invoke([wait,lookup])
    assert result[0]['status']=='succeeded' and result[0]['data']['object']['id']==h.state['fixture']['document']


def receipts(h, mode):
    params=write_params(h,mode);command=str(uuid.uuid4());params['commandId']=command
    first=h.run('operation','documentFieldsUpdate',params,mode)
    if mode=='direct':
        stale=h.run('operation','documentFieldsUpdate',params,mode,negative=True)
        assert stale['error_code']=='revision_conflict' and stale['_ldo']['command_id']
        assert h.document()['revision']==first['revision']
        assert h.document()['comment']==h.state['marker']+' updated'
        return
    repeated=h.run('operation','documentFieldsUpdate',params,mode)
    assert repeated['revision']==first['revision']==h.document()['revision']
    stale_id=str(uuid.uuid4())
    stale=h.run('operation','documentFieldsUpdate',{**params,'commandId':stale_id},mode,negative=True)
    assert 'error' in stale
    retained=h.run('queue','getResult',{'queuedCommandId':stale_id})
    assert retained['status']=='failed' and retained['error']['code']=='revision_conflict'
    collision=h.run('operation','documentFieldsUpdate',{**params,'documentChanges':json.dumps({'comment':'must not apply'})},mode,negative=True)
    assert 'error' in collision and h.document()['comment']==h.state['marker']+' updated'


def queue_cleanup(h, mode):
    if mode!='queue':raise NotAvailable('Queue cleanup is standalone only')
    table=h.state['connection']
    columns={'database_id':'fixture','profile_id':'fixture','policy_revision':'fixture'}
    status=h.run('connection','connectionStatus')
    columns={k:status[k] for k in columns}
    row={**columns,'kind':'command','command_id':str(uuid.uuid4()),'command_type':'n8n.document.get',
        'payload':'{}','result':'{}','status':'completed','lease_until':0,'attempt_count':0,'ready_at':1}
    # Old rows only in this suite-owned table, never another customer's table.
    h.n8n.api('POST','/data-tables/'+table+'/rows',{'data':[row]})
    result=h.run('queue','cleanup',{'retentionDays':1})
    assert result['removed']==0, 'Fresh completed entries must be retained'
    rows=h.n8n.api('GET','/data-tables/'+table+'/rows?limit=100')['data']
    assert any(r.get('command_id')==row['command_id'] for r in rows)


def connection_lifecycle(h, mode):
    if mode!='queue':raise NotAvailable('Connection actions are standalone only')
    created=h.run('connection','createConnection',{'connectionName':h.state['marker']+' lifecycle'},pump=False)
    h.state['tables'].append(created['connection_id']);h.state['workflows'].append(created['workflow_id']);h.save()
    status=h.run('connection','connectionStatus',{'connectionId':created['connection_id']},pump=False)
    assert status['status']=='pending'
    renewed=h.run('connection','renewPairing',{'connectionId':created['connection_id']},pump=False)
    assert renewed['pairing_code']!=created['pairing_code']
    disconnected=h.run('connection','disconnectConnection',{'connectionId':created['connection_id']},pump=False)
    assert disconnected['status']=='disabled'
    assert h.n8n.api('GET','/workflows/'+created['workflow_id'])['active'] is False


def isolation(h, mode):
    state=h.bridge.bsl('Отказ=Ложь; Попытка ЛДО_АвтоматизацияСервер.ПроверитьПодключениеMSRV(); Исключение Отказ=Истина; КонецПопытки; РезультатВыполнения=Новый Структура("msrv,blocked",ЛДО_АвтоматизацияСервер.СервисыMSRVПодключены(),Отказ);')
    assert state=={'msrv':False,'blocked':True}
    refused=h.run('operation','documentGet',{'documentType':'document.СчетНаОплату',
        'documentId':h.state['fixture']['document'],'fields':['not_allowed']},mode,negative=True)
    assert 'error' in refused


SCENARIOS=[
 ('capabilities',capabilities,['get-capabilities','dynamic-policy']),
 ('document-read',document_read,['get-document-fields']),
 ('document-write',document_write,['update-document-fields']),
 ('catalog-read',catalog_read,['get-catalog-fields']),
 ('catalog-write',catalog_write,['update-catalog-fields']),
 ('reference-search',references,['search-reference-values']),
 ('reference-write-three-modes',reference_write,['update-reference-field']),
 ('process-lifecycle',process,['start-external-process','get-external-process','transition-external-process','update-external-process-fields','cancel-external-process']),
 ('event-document-ack',events,['lease-events','retry-event','acknowledge-event']),
 ('pdf',pdf,['prepare-document-pdf']),
 ('wait-result',wait_result,['get-queue-result','wait-recovery']),
 ('receipts',receipts,['write-receipts']),
 ('cleanup',queue_cleanup,['clean-completed-entries']),
 ('connection-lifecycle',connection_lifecycle,['create-connection','connection-status','renew-pairing','disconnect-connection','queue-gateway']),
 ('access-isolation',isolation,['dynamic-policy']),
]


def ai_tool(h, mode):
    provider=h.config.get('ollama')
    if not provider:raise NotRun('Configure a reachable local Ollama URL/model; no paid provider is used')
    credential=h.credential('ollamaApi',{'baseUrl':provider['url']})
    agent={'id':str(uuid.uuid4()),'name':'Agent','type':'@n8n/n8n-nodes-langchain.agent','typeVersion':2.2,
        'position':[500,300],'parameters':{'promptType':'define',
        'text':'Call ReadInvoice once with empty arguments. Return its invoice number and date. Never invent data.',
        'options':{'systemMessage':'Always call ReadInvoice before answering. This tool is fully configured and requires {}. Answer with its number and date.',
                   'maxIterations':3,'returnIntermediateSteps':True,'enableStreaming':False}}}
    model={'id':str(uuid.uuid4()),'name':'Local model','type':'@n8n/n8n-nodes-langchain.lmChatOllama','typeVersion':1,
        'position':[350,550],'parameters':{'model':provider['model'],
        'options':{'think':False,'temperature':0,'numCtx':4096,'numPredict':192,'numThread':2}},
        'credentials':{'ollamaApi':credential}}
    tool=h.action('ReadInvoice','operation','documentGet',{'documentType':'document.СчетНаОплату',
        'documentId':h.state['fixture']['document'],'fields':['number','date'],
        'descriptionType':'manual','toolDescription':'Read the configured 1C invoice number and date. No arguments needed.'},mode)
    tool['type']='n8n-nodes-ldo-1c-relay.ldo1cRelayTool';tool['position']=[650,550]
    connections={'Request':{'main':[[{'node':'Agent','type':'main','index':0}]]},
        'ReadInvoice':{'ai_tool':[[{'node':'Agent','type':'ai_tool','index':0}]]},
        'Local model':{'ai_languageModel':[[{'node':'Agent','type':'ai_languageModel','index':0}]]}}
    results=h.invoke([agent,model,tool],pump=mode=='queue',connections=connections)
    assert results and any('command_id' in json.dumps(step) and 'number' in json.dumps(step)
        for step in results[0].get('intermediateSteps',[])), 'Agent did not call the actual 1C node tool'
    expected=h.read(mode)['values']['number']
    assert expected in results[0]['output'], 'Agent answer is unrelated to native invoice'

SCENARIOS.append(('ai-tool',ai_tool,['ai-tool']))

from search_cases import document_search, catalog_search, search_policy_guards
SCENARIOS.extend([("document-search",document_search,["search-documents"]),("catalog-search",catalog_search,["search-catalog-items"])])

SCENARIOS.append(("search-native-policy",search_policy_guards,["search-documents","search-catalog-items","dynamic-policy"]))
