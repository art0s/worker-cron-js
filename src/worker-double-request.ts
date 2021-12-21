//=====================================================================================================================
//
// Double request worker - makes two requests to API by given url
//
//=====================================================================================================================
let TaskId = -1;
let Url = null;
let WithCredentials = false;
let ConstructPostParamsFunction = null;
let TaskParams = null;

//=====================================================================================================================
// makes GET request
//=====================================================================================================================
const request = (url: string, method: 'GET' | 'POST', formData: any, callback: (param: XMLHttpRequest) => void) => {
    const transport = new XMLHttpRequest();
    transport.onreadystatechange = function () {
        if (transport.readyState === 4) {
            callback(transport);
        }
    };

    transport.onerror = function () {
        postMessage({
            TaskId,
            error: 'failed',
        });
    };

    transport.timeout = 15000;
    transport.responseType = 'json';

    transport.open(method, url, true);
    transport.withCredentials = WithCredentials;
    transport.send(method === 'GET' ? '' : formData);
};

//=====================================================================================================================
// makes FormData based object
//=====================================================================================================================
const toFormData = (obj: object, form?: FormData, namespace?: string) => {
    let fd = form || new FormData();
    let formKey: string;

    for (let property in obj) {
        if (obj.hasOwnProperty(property) && obj[property] !== undefined && obj[property] !== null) {
            if (namespace) {
                formKey = namespace + '[' + property + ']';
            } else {
                formKey = property;
            }

            if (obj[property] instanceof Date) {
                fd.append(formKey, obj[property].toISOString());
            } else if (typeof obj[property] === 'object' && !(obj[property] instanceof File)) {
                toFormData(obj[property], fd, formKey);
            } else {
                fd.append(formKey, obj[property]);
            }
        }
    }

    return fd;
};

//=====================================================================================================================
// makes double request
//=====================================================================================================================
const makeFirstRequest = (data: any) => {
    TaskId = data.id;
    Url = data.url;
    WithCredentials = data.withCredentials;
    ConstructPostParamsFunction = new Function('data', 'params', data.paramsConstructor);
    TaskParams = data.taskParams;

    request(Url, 'GET', null, (xml) => {
        makeSecondRequest(xml);
    });
};

//=====================================================================================================================
// makes double request
//=====================================================================================================================
const makeSecondRequest = (requestGet: XMLHttpRequest) => {
    let jsonAnswer = null;
    if (requestGet && requestGet.readyState === 4 && requestGet.response) {
        jsonAnswer = requestGet.response;
    }

    let objData = null;
    try {
        objData = ConstructPostParamsFunction(jsonAnswer, TaskParams);
    } catch (err) {
        objData = null;
    }

    if (!objData) {
        postMessage({
            TaskId,
            error: 'failed',
        });
        return;
    }

    const formData = toFormData(objData);

    if (!formData) {
        postMessage({
            TaskId,
            error: 'failed',
        });
        return;
    }

    request(Url, 'POST', formData, (xml) => {
        let jsonPostAnswer = null;
        if (xml && xml.readyState === 4 && xml.response) {
            jsonPostAnswer = xml.response;
        }

        postMessage({
            TaskId,
            answer: jsonPostAnswer,
        });
    });
};

//=====================================================================================================================
// onMessage handler
//=====================================================================================================================
onmessage = (e) => {
    if (
        e &&
        e.data &&
        typeof e.data === 'object' &&
        e.data.id &&
        e.data.url &&
        'withCredentials' in e.data &&
        e.data.paramsConstructor &&
        e.data.taskParams
    ) {
        makeFirstRequest(e.data);
    }
};

//=====================================================================================================================
