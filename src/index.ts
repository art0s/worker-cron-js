const functionToString = (func) => {
    const _fn = func.toString();
    return _fn.substring(_fn.indexOf('{') + 1, _fn.lastIndexOf('}'));
};

function paramsConstructor(data: Object) {
    console.log('--------------------- params constructor')
    console.log(data)
    console.log('---------------------')

    const formData = new FormData();
    formData.append('strData', data.toString());
    return formData;
}

function successCondition(data: { status: string } | null | undefined): boolean {
    console.log('--------------------- success condition')
    console.log(data)
    console.log('---------------------')

    if (!data || data.status !== 'ok') return false;
    return true;
}

const worker = new Worker('./worker-cron.js?_=' + Date.now());
worker.onmessage = (e) => {
    if (!e || !e.data) return;
    console.log(JSON.stringify(e.data, null, 2));
};
worker.postMessage({
    sourceId: '234234',
    innerId: Date.now(),
    task: 'doubleRequest',
    schedule: '5m',
    url: 'https://jsonplaceholder.typicode.com/users',
    maxTries: 10,
    withCredentials: true,
    paramsConstructor: functionToString(paramsConstructor),
    successCondition: functionToString(successCondition),
    taskParams: {
        accountId: 1
    }
});
worker.postMessage('start');
