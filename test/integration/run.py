#!/usr/bin/env python3
"""Reproducible node capability suite. Requires an explicitly registered disposable UNF."""
from __future__ import annotations
import argparse
import json
import os
import time
import traceback
import xml.etree.ElementTree as ET
from pathlib import Path
from harness import Harness
from cases import SCENARIOS, NotAvailable, NotRun


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True,help='Private JSON with database, n8nUrl and n8nApiKeyEnv')
    parser.add_argument('--output',required=True,help='Private output and recovery ledger directory')
    parser.add_argument('--allow-writes',action='store_true',help='Exclusive registered demo fixture; restores previous settings')
    parser.add_argument('--preflight',action='store_true')
    parser.add_argument('--cleanup',action='store_true')
    parser.add_argument('--only',default='',help='Comma-separated scenario IDs; empty means all')
    args=parser.parse_args()
    config=json.loads(Path(args.config).read_text())
    config['apiKey']=os.environ.get(config.get('n8nApiKeyEnv','LDO_TEST_N8N_API_KEY'),'')
    if not config['apiKey']:raise SystemExit('Required n8n API key environment variable is empty')
    modes=config.get('modes',['queue'])
    if not modes or any(m not in ['queue','direct'] for m in modes):raise SystemExit('Supported live modes: queue, direct')
    if 'direct' in modes and not config.get('directServiceUrl'):raise SystemExit('directServiceUrl required')
    if not args.allow_writes and not args.preflight:raise SystemExit('--allow-writes required for suite or recovery')
    h=Harness(config,args.output,resume=args.cleanup)
    if args.cleanup:
        h.cleanup();print('Fixture recovery cleanup passed');return 0
    initial=h.preflight()
    if args.preflight:
        print('Registered bridge and n8n Public API available; no changes made')
        print('Approval capture configured:',bool(initial['captureEnabled'] and initial['epochPresent']))
        return 0
    selected=set(filter(None,args.only.split(',')))
    valid={s[0] for s in SCENARIOS}
    if selected-valid:raise SystemExit('Unknown scenario ID')
    registry=json.loads((Path(__file__).parents[2]/'docs/capabilities/registry.json').read_text())
    ids={v['id'] for g in ['operations','features'] for v in registry[g]}
    report={'schemaVersion':1,'packageVersion':config.get('nodePackageVersion'),
        'method':'Real n8n node workflows via Public API and authenticated webhooks; server fixtures/assertions via registered 1C bridge',
        'initialApprovalCapture':initial,'cases':[],'cleanup':'not-run'}
    started=time.monotonic()
    def record(id,status,coverage,detail='',seconds=0):
        report['cases'].append({'id':id,'status':status,'coverage':coverage,'detail':detail,'seconds':round(seconds,2)})
        print(id+': '+status,flush=True)
    try:
        h.prepare()
        record('prepare-and-pair','passed',['create-connection','queue-gateway','extension-distribution'])
        paired=h.preflight();report['pairedApprovalCapture']=paired
        record('ordinary-event-onboarding','passed' if paired['captureEnabled'] and paired['epochPresent'] else 'failed',
            ['extension-distribution'],'Native pairing enabled approval capture and its epoch without additional bridge configuration')
        for mode in modes:
            h.mode(mode)
            for id,fn,coverage in SCENARIOS:
                if selected and id not in selected:continue
                begin=time.monotonic()
                try:
                    fn(h,mode);record(mode+'/'+id,'passed',coverage,seconds=time.monotonic()-begin)
                except NotAvailable as error:
                    record(mode+'/'+id,'not-applicable',coverage,str(error),time.monotonic()-begin)
                except NotRun as error:
                    record(mode+'/'+id,'not-run',coverage,str(error),time.monotonic()-begin)
                except Exception as error:
                    # No payload values or raw exceptions are put into public/console reports.
                    record(mode+'/'+id,'failed',coverage,type(error).__name__,time.monotonic()-begin)
                    private=Path(args.output)/(mode+'-'+id+'.private.txt')
                    locations='\n'.join(str(Path(frame.filename).name)+':'+str(frame.lineno) for frame in traceback.extract_tb(error.__traceback__))
                    private.write_text(type(error).__name__+'\n'+str(error)+'\n'+locations);private.chmod(0o600)
        record('msrv-pdf-confirm','not-run',['confirm-pdf-delivery'],'Requires isolated enrolled MSRV fixture; existing contract tests cover this action, no MSRV enrollment is provisioned by this suite')
        if not any(c['id'].endswith('/ai-tool') for c in report['cases']):
            record('ai-tool-live','not-run',['ai-tool'],'Select the ai-tool scenario and configure a reachable local model')
    except Exception as error:
        record('fixture-setup','failed',[],type(error).__name__)
        private=Path(args.output)/'setup.private.txt';private.write_text(type(error).__name__+'\n'+str(error));private.chmod(0o600)
    finally:
        try:
            h.cleanup();report['cleanup']='passed'
        except Exception:
            report['cleanup']='failed';record('fixture-cleanup','failed',[],'Use --cleanup with durable state.private.json')
        covered={id for c in report['cases'] for id in c['coverage']}
        report['unmapped']=sorted(ids-covered)
        report['durationSeconds']=round(time.monotonic()-started,2)
        report['overall']='failed' if report['cleanup']!='passed' or any(c['status']=='failed' for c in report['cases']) else 'passed-with-explicit-gaps' if any(c['status']=='not-run' for c in report['cases']) else 'passed'
        report['capabilities']={id:[{'case':c['id'],'status':c['status']} for c in report['cases'] if id in c['coverage']] for id in sorted(ids)}
        Path(args.output,'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        junit=ET.Element('testsuite',name='ldo-node-capabilities',tests=str(len(report['cases'])))
        for c in report['cases']:
            test=ET.SubElement(junit,'testcase',name=c['id'],time=str(c['seconds']))
            if c['status']=='failed':ET.SubElement(test,'failure',message=c['detail'])
            elif c['status'] in ['not-run','not-applicable']:ET.SubElement(test,'skipped',message=c['detail'])
        ET.ElementTree(junit).write(Path(args.output,'junit.xml'),encoding='utf-8',xml_declaration=True)
    print('Overall:',report['overall'],'; cleanup:',report['cleanup'],flush=True)
    return 1 if report['overall']=='failed' else 0


if __name__=='__main__':
    raise SystemExit(main())
