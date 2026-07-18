import type { RuntimeView } from "../ui/runtime-view.js";

interface RuntimeRecordsProps {
  readonly view: RuntimeView;
}

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function RuntimeRecords({ view }: RuntimeRecordsProps) {
  return (
    <section className="records-grid" aria-label="Evidence and grant records">
      <article className="panel record-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Durable record</span>
            <h2>Evidence</h2>
          </div>
          {view.canExport ? (
            <a className="button button--quiet" href="/api/runtime?export=1" download>
              Export JSON
            </a>
          ) : null}
        </div>
        {view.evidenceRecord ? (
          <div data-testid="evidence-record">
            <dl className="record-list">
              <div>
                <dt>Evidence ID</dt>
                <dd>{view.evidenceRecord.evidenceRecordId}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{view.evidenceRecord.policyVersion}</dd>
              </div>
              <div>
                <dt>Action digest</dt>
                <dd title={view.evidenceRecord.actionDigest}>
                  {shortHash(view.evidenceRecord.actionDigest)}
                </dd>
              </div>
            </dl>
            <details>
              <summary>View committed JSON</summary>
              <pre data-testid="evidence-json">
                {JSON.stringify(view.evidenceRecord, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <div className="empty-state" data-testid="no-evidence">
            <span>No evidence record</span>
            <p>Authorization cannot complete until this record commits.</p>
          </div>
        )}
      </article>

      <article className="panel record-panel">
        <span className="eyebrow">Single-use capability</span>
        <h2>Authorization grant</h2>
        {view.grant ? (
          <dl className="record-list" data-testid="grant-details">
            <div>
              <dt>Grant ID</dt>
              <dd>{view.grant.grantId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{view.grant.status}</dd>
            </div>
            <div>
              <dt>Evidence ID</dt>
              <dd>{view.grant.evidenceRecordId}</dd>
            </div>
          </dl>
        ) : (
          <div className="empty-state" data-testid="no-grant">
            <span>No authorization grant</span>
            <p>Nothing can reach the robot adapter.</p>
          </div>
        )}
      </article>
    </section>
  );
}
