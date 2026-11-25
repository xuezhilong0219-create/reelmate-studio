
import { esc } from '../lib.js';
import { TOOLS, GROUPS } from '../tools-spec.js';

export async function render() {
  return [
    '<div class="page-head">',
    '  <div><h1>工具箱</h1><p>' + TOOLS.length + ' 个 AI 创作能力，全部本地运行，无额度无付费</p></div>',
    '</div>',
    '<div class="pill-tabs" id="tabs">',
    '<button class="on" data-g="all">全部 ' + TOOLS.length + '</button>',
    GROUPS.map((g) => '<button data-g="' + esc(g) + '">' + esc(g) + ' ' + TOOLS.filter((t) => t.group === g).length + '</button>').join(''),
    '</div>',
    '<div class="grid g3" id="tool-grid">' + TOOLS.map(card).join('') + '</div>',
  ].join('');
}

function card(t) {
  return '<a class="card hover tool-card" data-group="' + esc(t.group) + '" href="#/tools/' + t.id + '" style="text-decoration:none">' +
    '<div class="tc-ico">' + t.icon + '</div>' +
    '<div class="tc-title">' + esc(t.title) + '</div>' +
    '<div class="tc-desc">' + esc(t.desc) + '</div>' +
    '<div class="tc-go">开始创作 →</div></a>';
}

export async function mount(view) {
  const grid = view.querySelector('#tool-grid');
  view.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    view.querySelectorAll('#tabs button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const g = b.getAttribute('data-g');
    grid.querySelectorAll('[data-group]').forEach((c) => {
      c.style.display = (g === 'all' || c.getAttribute('data-group') === g) ? '' : 'none';
    });
  }));
}
