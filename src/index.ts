const worker = new Worker('./worker-cron.js?_=' + Date.now());
worker.onmessage = (e) => {
    if (!e || !e.data) return;
    console.log(JSON.stringify(e.data, null, 2));
};
worker.postMessage({
    innerId: Date.now(),
    task: 'request',
    schedule: '5m',
    url: 'https://google.com',
    withCredential: true,
});
worker.postMessage('start');
