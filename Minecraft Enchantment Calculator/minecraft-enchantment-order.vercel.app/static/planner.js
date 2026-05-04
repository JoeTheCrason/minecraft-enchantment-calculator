const ENCHANTS = window.ENCHANTS;
const NAMES = window.NAMES;
const CURRENT_LV = Object.create(null);

let allowIncompat = false;

function prettify(ns) {
    return NAMES[ns] || ns;
}

const form = document.getElementById('planner-form');
const itemSel = document.getElementById('item-select');
const dyn = document.getElementById('dynamic-area');
const modeBlk = document.getElementById('mode-block');
const resBlk = document.getElementById('result-block');

// store the hidden inputs per enchant for form submission
let curInputs = {}, desInputs = {};

itemSel.addEventListener('change', () => buildTables(itemSel.value));

function updateCalcButton() {
    const anyDesiredSelected = !!document.querySelector('#des-block .level-btn.selected');
    document.getElementById('calc-btn').disabled = !anyDesiredSelected;
}

function buildTables(item) {
    dyn.innerHTML = '';
    resBlk.style.display = 'none';
    curInputs = {};
    desInputs = {};
    Object.keys(CURRENT_LV).forEach(k => delete CURRENT_LV[k]);

    if (!item) {
        modeBlk.classList.add('hidden');
        return;
    }

    // figure out which enchants apply
    const applicable = ENCHANTS.filter(([ns, m]) => m.items.includes(item));
    const curses = ['curse_of_binding', 'curse_of_vanishing'];
    const nonCurses = applicable.map(([ns]) => ns).filter(ns => !curses.includes(ns));

    // group by incompatibility clusters
    const remaining = new Set(nonCurses);
    const groups = [];
    while (remaining.size) {
        const root = [...remaining][0],
            queue = [root],
            group = new Set();
        while (queue.length) {
            const x = queue.pop();
            if (!remaining.has(x)) continue;
            remaining.delete(x);
            group.add(x);
            ENCHANTS.find(([n]) => n === x)[1]
                .incompatible.forEach(i => remaining.has(i) && queue.push(i));
        }
        groups.push([...group]);
    }
    groups.sort((a, b) => b.length - a.length);
    curses.forEach(c => {
        if (applicable.some(([ns]) => ns === c)) groups.push([c]);
    });

    // build both panels
    [['cur', '2. Current Enchants'], ['des', '3. Desired Enchants']]
        .forEach(([key, title]) => {
            const wrap = document.createElement('div');
            wrap.className = 'ench-container';
            if (key === 'des') {
                wrap.id = 'des-block';
                wrap.innerHTML = `
                    <div class="flex items-baseline justify-between mb-4">
                      <h3 class="text-sm font-semibold m-0 leading-none">${title}</h3>
                      <label class="inline-flex items-center gap-2 text-sm">
                        Allow Incompatible:
                        <input type="checkbox" id="allow-incompat"/>
                      </label>
                    </div>`;
            } else {
                wrap.id = 'cur-block';
                wrap.innerHTML = `
                    <div class="flex items-baseline justify-between mb-4">
                      <h3 class="text-sm font-semibold m-0 leading-none">${title}</h3>
                      <label class="inline-flex items-center gap-2 text-sm">
                        Anvil Use Count:
                        <input type="number" name="prior_work" value="0" min="0" max="39"
                          class="w-16 rounded border border-slate-700 bg-slate-800
                                 px-2 py-1 text-slate-100 text-center">
                      </label>
                    </div>`;
            }

            let stripe = 0;
            groups.forEach(group => {
                group.forEach(ns => {
                    const meta = ENCHANTS.find(([n]) => n === ns)[1];
                    const row = document.createElement('div');
                    row.className = `ench-row stripe-${stripe}`;
                    row.dataset.ns = ns;
                    row.dataset.incompat = meta.incompatible.join(',');
                    row.innerHTML = `
          <span class="ench-name">${prettify(ns)}</span>
          <div class="level-cell"></div>`;

                    const cell = row.querySelector('.level-cell');
                    const hidden = document.createElement('input');
                    hidden.type = 'hidden';
                    hidden.name = `${key}-${ns}`;
                    row.appendChild(hidden);

                    if (key === 'cur') curInputs[ns] = hidden;
                    else desInputs[ns] = hidden;

                    for (let lv = 1; lv <= meta.levelMax; lv++) {
                        const b = document.createElement('button');
                        b.type = 'button';
                        b.textContent = lv;
                        b.className = 'level-btn';
                        b.dataset.level = lv;
                        b.addEventListener('click', () => toggle(b, hidden, row));
                        cell.appendChild(b);
                    }

                    wrap.appendChild(row);
                });
                stripe ^= 1;
            });

            dyn.appendChild(wrap);
        });

    const allowCheckbox = document.getElementById('allow-incompat');
    const allowHidden = document.getElementById('allow-incompat-hidden');

    if (allowCheckbox) {
        allowCheckbox.addEventListener('change', e => {
            allowIncompat = e.target.checked;
            allowHidden.value = e.target.checked;       // send "true"/"false" to server
            if (!allowIncompat) purgeIncompat();
            refreshPanels();
        });
    }

    modeBlk.classList.remove('hidden');
    refreshPanels();
}

function clearRow(row) {
    row.querySelectorAll('.level-btn.selected')
        .forEach(b => b.classList.remove('selected'));
    row.querySelector('input[type="hidden"]').value = '';
}

function toggle(btn, hidden, row) {
    const isCur = !!row.closest('#cur-block'),
        ns = row.dataset.ns;

    if (btn.classList.contains('selected')) {
        // deselect
        clearRow(row);
        if (isCur) delete CURRENT_LV[ns];
    } else {
        // select exactly one level
        clearRow(row);
        btn.classList.add('selected');
        hidden.value = btn.dataset.level;
        if (isCur) CURRENT_LV[ns] = +btn.dataset.level;
    }

    // clear any direct incompatibilities
    if (!allowIncompat && isCur) {
        row.dataset.incompat.split(',')
            .filter(Boolean)
            .forEach(i => {
                const sib = document.querySelector(`.ench-row[data-ns="${i}"]`);
                if (sib) {
                    clearRow(sib);
                    delete CURRENT_LV[i];
                }
            });
    }

    refreshPanels();
}

function updateDisable() {
    // collect all enchant types that are selected (cur+des)
    const curSel = Object.keys(CURRENT_LV);
    const desSel = [...document.querySelectorAll('#des-block .level-btn.selected')]
        .map(b => b.closest('.ench-row').dataset.ns);
    const sel = new Set([...curSel, ...desSel]);

    // build global incompatibility set
    const dis = new Set();
    if (!allowIncompat) {
        sel.forEach(ns =>
            ENCHANTS.find(([n]) => n === ns)[1]
                .incompatible.forEach(i => dis.add(i))
        );
    }

    // apply to every row except self-selected enchant types
    document.querySelectorAll('.ench-row').forEach(r => {
        const ns = r.dataset.ns,
            keep = sel.has(ns),
            off = dis.has(ns) && !keep;
        r.classList.toggle('disabled-row', off);
        r.querySelectorAll('.level-btn').forEach(b => b.disabled = off);
    });
}

function refreshCurrentPanel() {
    // look at desired selections for each enchant
    const desiredLv = Object.fromEntries(
        [...document.querySelectorAll('#des-block .ench-row')].map(row => {
            const ns = row.dataset.ns;
            const btn = row.querySelector('.level-btn.selected');
            return [ns, btn ? +btn.dataset.level : 0];
        })
    );

    document.querySelectorAll('#cur-block .ench-row').forEach(row => {
        const ns = row.dataset.ns,
            have = CURRENT_LV[ns] || 0,
            want = desiredLv[ns] || 0,
            btns = [...row.querySelectorAll('.level-btn')];

        btns.forEach(b => {
            const lv = +b.dataset.level,
                sel = b.classList.contains('selected');

            // if there's a desired target, disable any cur-level ≥ desired
            if (!sel && want > 0 && lv >= want) {
                b.disabled = true;
                b.style.opacity = '.25';
            } else if (!sel) {
                // restore to base disabled state from updateDisable()
                b.disabled = b.disabled;
                b.style.opacity = '';
            } else {
                // keep your own selection always enabled
                b.disabled = false;
                b.style.opacity = '';
            }
        });
    });
}

function purgeIncompat() {
    // collect every selected enchant type
    const selected = [...document.querySelectorAll('.level-btn.selected')]
        .map(b => b.closest('.ench-row').dataset.ns);

    // for each pair, if they conflict, clear *both* rows
    for (let i = 0; i < selected.length; i++) {
        for (let j = i + 1; j < selected.length; j++) {
            const a = selected[i], b = selected[j];
            const metaA = ENCHANTS.find(([n]) => n === a)[1];
            const metaB = ENCHANTS.find(([n]) => n === b)[1];
            if (metaA.incompatible.includes(b) || metaB.incompatible.includes(a)) {
                [a, b].forEach(ns => {
                    // clear _every_ row with that ns (cur + des)
                    document.querySelectorAll(`.ench-row[data-ns="${ns}"]`)
                        .forEach(row => {
                            clearRow(row);
                            if (row.closest('#cur-block')) delete CURRENT_LV[ns];
                        });
                });
            }
        }
    }
}

function refreshDesiredPanel() {
    document.querySelectorAll('#des-block .ench-row').forEach(row => {
        const ns = row.dataset.ns,
            have = CURRENT_LV[ns] || 0,
            btns = [...row.querySelectorAll('.level-btn')],
            sel = btns.some(b => b.classList.contains('selected'));

        // if not yet chosen, hide levels ≤ current
        btns.forEach(b => {
            const lv = +b.dataset.level,
                selb = b.classList.contains('selected');

            if (selb) {
                // keep your own pick always on
                b.disabled = false;
                b.style.opacity = '';
            } else if (lv <= have) {
                // disallow any level <= your current
                b.disabled = true;
                b.style.opacity = '.25';
            } else {
                // leave everything else in its post-disable state
                b.disabled = b.disabled;
                b.style.opacity = '';
            }
        });
    });
}

function refreshPanels() {
    updateDisable();
    refreshCurrentPanel();
    refreshDesiredPanel();
    updateCalcButton();
}

form.addEventListener('submit', e => {
    e.preventDefault();
    fetch(form.action, {
        method: 'POST',
        body: new FormData(form)
    }).then(r => r.redirected
        ? window.location = r.url
        : r.text()
    ).then(html => {
        if (!html) return;
        resBlk.innerHTML = html;
        resBlk.style.display = 'block';
        resBlk.scrollIntoView({behavior: 'smooth'});
    });
});
