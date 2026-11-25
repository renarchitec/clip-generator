const $ = (id) => document.getElementById(id);
const log = (line) => {
  const el = $('log');
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
};

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('files').textContent = '';
  $('log').textContent = '';
  $('bar').value = 0;
  const ranges = $('ranges').value.split(',').map((s) => s.trim()).filter(Boolean);
  const res = await window.dartclip.render({
    url: $('url').value.trim(),
    ranges,
    encoder: $('encoder').value,
  });
  if (!res.ok) {
    $('status').textContent = res.error;
    return;
  }
  $('go').disabled = true;
  $('status').textContent = 'Mulai…';
  log('worker: ' + res.bin);
});

window.dartclip.onEvent((ev) => {
  if (ev.event === 'progress') {
    $('bar').value = ev.percent;
    $('status').textContent = `${ev.stage}: ${ev.message}`;
  } else if (ev.event === 'start') {
    log(`job ${ev.jobId} · encoder ${ev.encoder} · mode ${ev.mode} · LLM ${ev.llm || 'tidak ada'}`);
  } else if (ev.event === 'done') {
    $('bar').value = 100;
    $('status').textContent = `Selesai dalam ${ev.seconds} dtk. Klip di ${ev.folder}`;
    for (const file of ev.files) {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = file;
      a.onclick = (e) => {
        e.preventDefault();
        window.dartclip.reveal(file);
      };
      $('files').appendChild(a);
    }
  } else if (ev.event === 'error') {
    $('status').textContent = 'Gagal: ' + ev.message;
  }
});
window.dartclip.onLog(log);
window.dartclip.onExit(({ code, error }) => {
  $('go').disabled = false;
  if (code !== 0) log(`worker keluar dengan kode ${code}${error ? ': ' + error : ''}`);
});
