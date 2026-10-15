"""Durable disposable fixture; actual published nodes execute via authenticated webhooks."""
from __future__ import annotations
import concurrent.futures
import hashlib
import fcntl
import tempfile
import json
import time
import uuid
from urllib.parse import quote
from pathlib import Path
from client import Bridge, N8n, RequestFailure, registered_database

NODE = 'n8n-nodes-ldo-1c-relay.ldo1cRelay'


class Harness:
    def __init__(self, config, directory, resume=False):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.path = self.directory/'state.private.json'
        self.config = config
        self.db = registered_database(config['database'])
        if 'direct' in config.get('modes',[]) and config.get('directServiceUrl') != self.db['WebUrl'].rstrip('/')+'/hs/ldo_n8n':
            raise RequestFailure('Direct service must belong to the selected registered database WebUrl')
        self.bridge = Bridge(self.db)
        self.n8n = N8n(config['n8nUrl'], config['apiKey'])
        if self.db.get('Password'):self.n8n.http.secrets.append(self.db['Password'])
        key=hashlib.sha256((self.db.get('Srvr','')+'/'+self.db['Ref']).encode()).hexdigest()
        self.exclusive=open(Path(tempfile.gettempdir())/('ldo-capability-'+key+'.lock'),'a')
        try:fcntl.flock(self.exclusive,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RequestFailure('Another local capability run owns this registered database')
        self.state = json.loads(self.path.read_text()) if resume else {
            'marker': 'LDO-CAP-'+uuid.uuid4().hex, 'workflows': [], 'credentials': [],
            'tables': [], 'commands': [], 'processes': [], 'database': config['database'],
            'n8nUrl': self.n8n.url}
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        if not resume and self.path.exists():
            raise RequestFailure('Existing state requires --cleanup; refusing to overwrite recovery ledger')
        if resume:
            assert self.state['database'] == config['database'], 'Recovery database differs'
            assert self.state.get('n8nUrl',self.n8n.url)==self.n8n.url, 'Recovery n8n differs'

    def save(self):
        text = json.dumps(self.state, ensure_ascii=False, indent=2)
        temp = self.path.with_suffix('.tmp')
        temp.write_text(text); temp.chmod(0o600); temp.replace(self.path)

    def preflight(self):
        self.bridge.preflight()
        for attempt in range(41):
            try:
                self.n8n.api('GET', '/workflows?limit=1');break
            except RequestFailure as error:
                if attempt==40 or not str(error).startswith(('HTTP 404','HTTP 503','Connection unavailable')):raise
                time.sleep(1)
        return self.bridge.bsl('В=Справочники.ЛДО_Настройки.Выбрать(); В.Следующий(); Н=В.НастройкиАвтоматизации.Получить(); Ф=Ложь; Н.Свойство("ФиксироватьЦиклыN8N",Ф); П=""; Н.Свойство("ПоколениеЦикловN8N",П); РезультатВыполнения=Новый Структура("captureEnabled,epochPresent",Ф=Истина,Не ПустаяСтрока(П)); Р=Новый Массив; Для Каждого РШ Из РасширенияКонфигурации.Получить() Цикл Р.Добавить(Новый Структура("name,version",РШ.Имя,РШ.Версия)); КонецЦикла; РезультатВыполнения.Вставить("installedExtensions",Р);')

    def credential(self, kind, data):
        result = self.n8n.api('POST', '/credentials', {'name':self.state['marker']+' '+kind,'type':kind,'data':data})
        self.state['credentials'].append(result['id']); self.save()
        return {'id':result['id'],'name':self.state['marker']+' '+kind}

    def prepare(self):
        self.state['backup'] = self.bridge.fixture('snapshot.bsl'); self.save()
        self.state['fixture'] = self.bridge.fixture('prepare.bsl', [self.state['marker']]); self.save()
        self.state['queueCredential'] = self.credential('ldo1cQueueApi', {
            'apiUrl':self.config['n8nUrl'],'apiToken':self.config['apiKey'],'minimumWaitSeconds':0})
        self.state['webhookToken'] = uuid.uuid4().hex+uuid.uuid4().hex
        self.state['headerCredential'] = self.credential('httpHeaderAuth', {
            'name':'X-LDO-Capability-Test','value':self.state['webhookToken']})
        self.save()
        result = self.run('connection','createConnection',{'connectionName':self.state['marker']},pump=False)
        self.state['connection'] = result['connection_id']; self.state['tables'].append(result['connection_id'])
        self.state['workflows'].append(result['workflow_id']); self.save()
        pair = self.bridge.bsl('РезультатВыполнения=ЛДО_АвтоматизацияСервер.ПодключитьОчередьПоКодуN8N(Параметры[0],Параметры[1]);',[result['pairing_code'],self.state['fixture']['profile']['profile_id']])
        assert pair['status']=='paired'
        if 'direct' in self.config.get('modes', []):
            self.state['directCredential'] = self.credential('ldo1cApi',{
                'apiUrl':self.config['directServiceUrl'],'username':self.db.get('User',''),'password':self.db.get('Password','')})
        self.save()

    def mode(self, mode):
        profile = self.state['fixture']['profile']['profile_id']
        if mode == 'direct':
            self.bridge.bsl('ЛДО_АвтоматизацияСервер.НастроитьАвтономныйОбменN8N("direct","","",Параметры[0]); РезультатВыполнения=Истина;',[profile])
        else:
            # Restore the paired transport without changing local policy/capture state.
            self.bridge.bsl('В=Справочники.ЛДО_Настройки.Выбрать(); В.Следующий(); О=В.Ссылка.ПолучитьОбъект(); Н=О.НастройкиАвтоматизации.Получить(); Н.Вставить("РежимОбменаN8N","queue"); О.НастройкиАвтоматизации=Новый ХранилищеЗначения(Н); О.Записать(); РезультатВыполнения=ЛДО_АвтоматизацияСервер.РежимОбменаN8N();')

    def action(self, name, resource, operation, params, mode='queue'):
        parameters = {'connectionMode':mode,'resource':resource,'timeoutSeconds':60,'pollSeconds':1,
                      'connectionId':self.state.get('connection',''),**params}
        if operation is not None:
            parameters['finalizeAction' if resource=='finalize' else 'operation']=operation
        if mode=='queue' and resource=='operation' and operation not in ['referenceFieldUpdate','capabilities']:
            parameters.setdefault('commandId',str(uuid.uuid4()))
            self.state['commands'].append(parameters['commandId']); self.save()
        kind = 'ldo1cApi' if mode=='direct' else 'ldo1cQueueApi'
        credential = self.state['directCredential' if mode=='direct' else 'queueCredential']
        return {'id':str(uuid.uuid4()),'name':name,'type':NODE,'typeVersion':2,
                'position':[450,300],'parameters':parameters,'credentials':{kind:credential},'continueOnFail':True}

    def workflow(self, nodes, connections=None):
        path = 'ldo-cap-'+uuid.uuid4().hex
        entry={'id':str(uuid.uuid4()),'name':'Request','type':'n8n-nodes-base.webhook','typeVersion':2,
               'position':[200,300],'webhookId':str(uuid.uuid4()),
               'parameters':{'httpMethod':'POST','path':path,'authentication':'headerAuth','responseMode':'lastNode','responseData':'allEntries','options':{}},
               'credentials':{'httpHeaderAuth':self.state['headerCredential']}}
        chain=[entry]+nodes
        if connections is None:
            for i,node in enumerate(chain):node["position"]=[200+i*300,300]
        connections=connections or {a['name']:{'main':[[{'node':b['name'],'type':'main','index':0}]]} for a,b in zip(chain,chain[1:])}
        result=self.n8n.api('POST','/workflows',{'name':self.state['marker']+' '+nodes[-1]['name'],
            'nodes':chain,'connections':connections,'settings':{'executionOrder':'v1','saveDataSuccessExecution':'all','saveDataErrorExecution':'all'}})
        self.state['workflows'].append(result['id']); self.save()
        self.n8n.api('POST','/workflows/'+result['id']+'/activate',{})
        return path

    def invoke(self, nodes, pump=True, body=None, connections=None):
        path=self.workflow(nodes,connections)
        future=self.pool.submit(self.n8n.http.call,'POST',self.n8n.url+'/webhook/'+path,body or {},
            {'X-LDO-Capability-Test':self.state['webhookToken']},120)
        deadline=time.monotonic()+115
        while not future.done() and time.monotonic()<deadline:
            if pump:
                self.bridge.bsl('ЛДО_АвтоматизацияСервер.ОпросКомандАвтоматизации(); РезультатВыполнения=Истина;')
            time.sleep(.5)
        try:
            result=future.result(timeout=5)
        except RequestFailure as error:
            if 'No item to return was found' not in str(error) or len(nodes)!=1 or (nodes[0]['parameters'].get('resource')!='events' and nodes[0]['parameters'].get('operation') not in ['documentSearch','catalogSearch']):raise
            executions=self.n8n.api('GET','/executions?workflowId='+self.state['workflows'][-1]+'&limit=1')['data']
            execution=self.n8n.api('GET','/executions/'+str(executions[0]['id'])+'?includeData=true')
            assert execution['status']=='success'
            assert execution['data']['resultData']['runData'][nodes[0]['name']][-1]['data']['main'][0]==[]
            return []
        values=result if isinstance(result,list) else ([] if result is None else [result])
        self.collect_commands(values)
        return values

    def collect_commands(self, value):
        """Record actual generated IDs, including the tool's JSON observation."""
        if isinstance(value,dict):
            command=value.get('_ldo',{}).get('command_id')
            if command and command not in self.state['commands']:
                self.state['commands'].append(command);self.save()
            for nested in value.values():self.collect_commands(nested)
        elif isinstance(value,list):
            for nested in value:self.collect_commands(nested)
        elif isinstance(value,str) and value.startswith(('{','[')):
            try:self.collect_commands(json.loads(value))
            except ValueError:pass

    def run(self, resource, operation=None, params=None, mode='queue', pump=True, negative=False):
        values=self.invoke([self.action('Action',resource,operation,params or {},mode)],pump and mode=='queue')
        result=values[0] if values else {}
        if not negative:
            
            if 'error' in result and resource!='queue':
                self.state.setdefault('nodeErrors',[]).append({'resource':resource,'operation':operation,'error':str(result['error']).replace(self.config['apiKey'],'[redacted]')})
                self.save()
                raise RequestFailure('n8n node returned an operation error')
        return result

    def read(self, mode='queue', pdf=False):
        return self.run('operation','documentGet',{'documentType':'document.СчетНаОплату',
            'documentId':self.state['fixture']['pdfDocument' if pdf else 'document'],'fields':['number','date']},mode)

    def document(self):
        return self.bridge.bsl('О=Документы.СчетНаОплату.ПолучитьСсылку(Новый УникальныйИдентификатор(Параметры[0])).ПолучитьОбъект(); РезультатВыполнения=Новый Структура("comment,revision,responsible,posted",О.Комментарий,Строка(О.ВерсияДанных),Строка(О.Ответственный.УникальныйИдентификатор()),О.Проведен);',[self.state['fixture']['document']])

    def approve(self, document, approve=False):
        return self.bridge.bsl('Предмет=Документы.СчетНаОплату.ПолучитьСсылку(Новый УникальныйИдентификатор(Параметры[0])); ЛДО_ОбщийМодульСервер.ОтправитьНаСогласование(Предмет); Если Параметры[1] Тогда ЛДО_ОбщийМодульСервер.Согласовано(Предмет); КонецЕсли; РезультатВыполнения=Истина;',[document,approve])

    def cleanup(self):
        if self.state.get('cleaned'):
            self.pool.shutdown(wait=True);return
        errors=[]
        # Read only owned table command IDs to collect compound-action receipts.
        for table in self.state['tables']:
            try:
                cursor=''
                while True:
                    page=self.n8n.api('GET','/data-tables/'+table+'/rows?limit=100'+('&cursor='+quote(cursor,safe='') if cursor else ''))
                    rows=page['data']
                    for row in rows:
                        if row.get('kind')=='command' and row.get('command_id'):
                            self.state['commands'].append(row['command_id'])
                    cursor=page.get('nextCursor')
                    if not cursor:break
                self.save()
            except RequestFailure as e:
                if not str(e).startswith('HTTP 404'):errors.append('read owned queue ledger')
        if 'backup' in self.state and not self.state.get('oneCRestored'):
            try:
                assert self.bridge.fixture('cleanup.bsl',[json.dumps(self.state, ensure_ascii=False)]) is True
                self.state['oneCRestored']=True;self.save()
            except Exception:
                self.pool.shutdown(wait=True)
                self.state['cleanupErrors']=['restore 1C fixture'];self.save()
                raise RequestFailure('Restore 1C first; n8n artifacts retained for recovery')
        for group, endpoint in [('workflows','/workflows/'),('tables','/data-tables/'),('credentials','/credentials/')]:
            for id in reversed(list(dict.fromkeys(self.state[group]))):
                try:
                    if group=='workflows':
                        current=self.n8n.api('GET',endpoint+id)
                        assert self.state['marker'] in current['name'] or current['name'].startswith('LDO 1C Queue')
                        if current.get('active'):self.n8n.api('POST',endpoint+id+'/deactivate',{})
                    self.n8n.api('DELETE',endpoint+id)
                except RequestFailure as e:
                    if not str(e).startswith('HTTP 404'):errors.append('remove owned '+group)
                except Exception:errors.append('remove owned '+group)
        self.pool.shutdown(wait=True)
        self.state['cleanupErrors']=errors;self.state['cleaned']=not errors;self.save()
        assert not errors, 'Cleanup incomplete; use durable state with --cleanup'
