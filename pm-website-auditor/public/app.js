const form = document.getElementById('auditForm');
const urlInput = document.getElementById('urlInput');
const submitBtn = document.getElementById('submitBtn');
const loadingEl = document.getElementById('loading');
const termLines = document.getElementById('termLines');
const errorBox = document.getElementById('errorBox');
const reportEl = document.getElementById('report');
const statusPill = document.getElementById('statusPill');

const LOADING_MESSAGES = [
  'Fetching page…',
  'Reading DOM structure…',
  'Scanning headings, CTAs, forms…',
  'Mapping the user journey…',
  'Thinking like a PM…',
  'Drafting the audit…',
];

let loadingInterval = null;

function startLoadingAnimation() {
  termLines.innerHTML = '';
  let i = 0;
  const addLine = () => {
    if (i >= LOADING_MESSAGES.length) return;
    const div = document.createElement('div');
    div.className = 'line';
    div.textContent = LOADING_MESSAGES[i];
    termLines.appendChild(div);
    i++;
  };
  addLine();
  loadingInterval = setInterval(addLine, 1400);
}

function stopLoadingAnimation() {
  clearInterval(loadingInterval);
}

function setStatus(text, kind) {
  statusPill.textContent = text;
  statusPill.style.color = kind === 'error' ? 'var(--alert)' : 'var(--signal)';
  statusPill.style.borderColor = kind === 'error' ? 'var(--alert-dim)' : 'var(--signal-dim)';
}

function priorityTagClass(priority) {
  if (priority === 'high') return 'tag-high';
  if (priority === 'medium') return 'tag-medium';
  return 'tag-low';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderReport(data) {
  const { url, audit } = data;
  const scores = audit.scores || {};

  const scoreRows = [
    ['Clarity', scores.clarity],
    ['Trust', scores.trust],
    ['Conversion path', scores.conversionPath],
    ['Mobile readiness', scores.mobileReadiness],
    ['Content quality', scores.contentQuality],
  ];

  const workingHtml = (audit.workingWell || [])
    .map(
      (item) => `
      <div class="card">
        <div class="card-top">
          <span class="tag tag-ok">Working</span>
          <span class="card-title">${escapeHtml(item.title)}</span>
        </div>
        <p class="card-detail">${escapeHtml(item.detail)}</p>
      </div>`
    )
    .join('');

  const improvementsHtml = (audit.improvements || [])
    .map(
      (item) => `
      <div class="card">
        <div class="card-top">
          <span class="tag ${priorityTagClass(item.priority)}">${escapeHtml(item.priority || 'medium')}</span>
          <span class="card-title">${escapeHtml(item.title)}</span>
        </div>
        <p class="card-detail">${escapeHtml(item.detail)}</p>
      </div>`
    )
    .join('');

  const journeyHtml = (audit.userJourney || [])
    .map(
      (step, idx) => `
      <div class="journey-card">
        <div class="journey-index">Step ${idx + 1}</div>
        <div class="journey-stage">${escapeHtml(step.stage)}</div>
        <p class="journey-action">${escapeHtml(step.action)}</p>
        ${
          step.friction
            ? `<p class="journey-friction">⚠ ${escapeHtml(step.friction)}</p>`
            : ''
        }
        ${
          step.opportunity
            ? `<p class="journey-opportunity">→ ${escapeHtml(step.opportunity)}</p>`
            : ''
        }
      </div>`
    )
    .join('');

  reportEl.innerHTML = `
    <div class="report-head">
      <div class="stamp">
        <span class="score-num">${audit.overallScore ?? '–'}</span>
        <span class="score-label">Overall</span>
      </div>
      <div class="report-head-text">
        <div class="report-url">${escapeHtml(url)}</div>
        <p class="report-purpose">${escapeHtml(audit.inferredPurpose)}</p>
      </div>
    </div>

    <div class="summary-block">${escapeHtml(audit.summary)}</div>

    <div>
      <div class="section-title">Scorecard</div>
      <div class="scores-grid">
        ${scoreRows
          .map(
            ([label, val]) => `
          <div class="score-item">
            <div class="score-item-top">
              <span>${label}</span>
              <strong>${val ?? '–'}/10</strong>
            </div>
            <div class="meter"><div class="meter-fill" style="width:${((val || 0) / 10) * 100}%"></div></div>
          </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="section-title">What's working</div>
        <div class="card-list">${workingHtml || '<p class="card-detail">Nothing conclusive found.</p>'}</div>
      </div>
      <div>
        <div class="section-title">Fix this</div>
        <div class="card-list">${improvementsHtml || '<p class="card-detail">No issues surfaced.</p>'}</div>
      </div>
    </div>

    <div>
      <div class="section-title">User journey</div>
      <div class="journey-strip">${journeyHtml || '<p class="card-detail">Could not trace a journey.</p>'}</div>
    </div>
  `;

  reportEl.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  errorBox.classList.add('hidden');
  reportEl.classList.add('hidden');
  reportEl.innerHTML = '';
  loadingEl.classList.remove('hidden');
  submitBtn.disabled = true;
  setStatus('auditing…');
  startLoadingAnimation();

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }

    renderReport(data);
    setStatus('done');
  } catch (err) {
    errorBox.textContent = err.message || 'Something went wrong.';
    errorBox.classList.remove('hidden');
    setStatus('error', 'error');
  } finally {
    stopLoadingAnimation();
    loadingEl.classList.add('hidden');
    submitBtn.disabled = false;
  }
});
