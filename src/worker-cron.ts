//=====================================================================================================================
//
// Main worker - tasks starter
//
//=====================================================================================================================
// TS types/interfaces
//=====================================================================================================================
interface Task {
    // task's ID
    id: number;
    // command - what to do
    task: 'remove-task' | 'clone-vds';
    // current step of prcess
    step: string;
    // current status of process
    status: string;
    // failed trys count
    FailedTryCount: number;
    // last error
    LastError: any;
    // timer for process
    ProcessTimer: number | null;
    // timer for error
    ErrorTimer: number | null;
}

interface CloneVdsTask extends Task {
    // url of API
    apiUrl: string;
    // parameters of task
    params: any;
    // id of created for clone backup
    BackupId: number;
    // id of copied backup
    CopyBackupId: number;
    // id of creating vds from backup
    CreateVdsId: number;
}

//=====================================================================================================================
//
// Total vars
//
//=====================================================================================================================
let Timer = null;
const TimeOutInMinutes = 1;

const FailedTryCountMax = 3;
const FailedTryPause = 300000;

let CloneTasksList: Array<CloneVdsTask> = [];

//=====================================================================================================================
//
// Clone VDS API
//
//=====================================================================================================================
// create task based on given params
//=====================================================================================================================
const createCloneTask = (data: any) => {
    if (!data || !data.id || data.task !== 'clone-vds') {
        return;
    }
    if (findTaskById(data.id)) return;

    const { id, task, params, apiUrl, step, status } = data;
    const newTask: CloneVdsTask = {
        id,
        task,
        step,
        status,
        apiUrl,
        params,
        BackupId: !isNaN(data.BackupId) && data.BackupId > 0 ? data.BackupId : -1,
        CopyBackupId: !isNaN(data.CopyBackupId) && data.CopyBackupId > 0 ? data.CopyBackupId : -1,
        CreateVdsId: !isNaN(data.CreateVdsId) && data.CreateVdsId > 0 ? data.CreateVdsId : -1,
        FailedTryCount: 0,
        LastError: null,
        ProcessTimer: null,
        ErrorTimer: null,
    };

    CloneTasksList.push(newTask);
    processCloneTask(newTask);
};

//=====================================================================================================================
// starts clone of VDS
//=====================================================================================================================
const createBackup = (task: CloneVdsTask) => {
    // test task object
    if (!task || !task.id || !task.params || !task.params.acc) return;
    // if BackupId already exists
    if (!isNaN(task.BackupId) && task.BackupId > 0) return;

    const _url = `${task.apiUrl}/service/create/15`;

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf'] && json['model'] && json['status'] === 'form') {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    service_id: task.id,
                    account_id: task.params.acc,
                    reinstall: 0,
                };

                makeRequest(
                    _url,
                    'POST',
                    objToFormData(_post),
                    (jsonPost) => {
                        if (jsonPost && jsonPost['status'] === 'ok' && jsonPost['request']) {
                            postMessage({
                                id: task.id,
                                step: 'service/creating_backup',
                                status: 'request/status_processing',
                            });

                            task.LastError = null;
                            task.FailedTryCount = 0;

                            createBackupStatus(task);
                        } else {
                            errorHandler(task, createBackup)(jsonPost);
                        }
                    },
                    errorHandler(task, createBackup)
                );
            } else {
                errorHandler(task, createBackup)(json);
            }
        },
        errorHandler(task, createBackup)
    );
};

//=====================================================================================================================
// check status of creating backup process
//=====================================================================================================================
const createBackupStatus = (task: CloneVdsTask) => {
    let _url = `${task.apiUrl}/service/list?ServiceSearch[service_type_id]=15&ServiceSearch[parent_id]=${task.id}`;
    if (task.BackupId > 0) {
        _url = `${task.apiUrl}/service/list?ServiceSearch[service_id]=${task.BackupId}`;
    }

    makeRequest(
        _url,
        'GET',
        null,
        (jsonGet) => {
            if (jsonGet) {
                let _backup = null;

                if (
                    jsonGet.status === 'ok' &&
                    jsonGet.rows &&
                    jsonGet.rows.length &&
                    jsonGet.rows[0] &&
                    jsonGet.rows[0]['service_id']
                ) {
                    let _date = '0000-00-00 00:00:00';
                    const _rows = jsonGet.rows;

                    for (let l = 0; l < _rows.length; l++) {
                        if (_rows[l] && _rows[l].service_created && _rows[l].service_created > _date) {
                            _backup = _rows[l];
                            _date = _rows[l].service_created;
                        }
                    }
                }

                if (_backup) {
                    task.BackupId = parseInt(_backup.service_id, 10);
                    if (isNaN(task.BackupId) || task.BackupId < 0) {
                        postMessage({
                            id: task.id,
                            error: 'service/status_error',
                        });
                        return;
                    }

                    task.LastError = null;
                    task.FailedTryCount = 0;

                    if (_backup.service_status === 'active') {
                        // if not creating backup yet
                        if (task.CopyBackupId < 0) {
                            if (task.params.dcToMove) {
                                postMessage({
                                    id: task.id,
                                    step: 'backup/copy',
                                    status: 'request/type_unblock',
                                    BackupId: task.BackupId,
                                });

                                copyBackup(task);
                            } else {
                                postMessage({
                                    id: task.id,
                                    step: 'server/create_title',
                                    status: 'request/type_unblock',
                                    BackupId: task.BackupId,
                                });

                                createVds(task);
                            }
                        }
                    } else if (_backup.service_status === 'error') {
                        postMessage({
                            id: task.id,
                            error: 'service/status_error',
                        });
                    } else {
                        postMessage({
                            id: task.id,
                            status: _backup.service_status_text || 'request/status_processing',
                            BackupId: task.BackupId,
                        });

                        restartProcess(task, createBackupStatus);
                    }
                } else {
                    restartProcess(task, createBackupStatus);
                }
            } else {
                errorHandler(task, createBackupStatus)(jsonGet);
            }
        },
        errorHandler(task, createBackupStatus)
    );
};

//=====================================================================================================================
// copy VDS to DC
//=====================================================================================================================
const copyBackup = (task: CloneVdsTask) => {
    if (!isNaN(task.CopyBackupId) && task.CopyBackupId > 0) return;

    if (isNaN(task.BackupId) || !task.BackupId || task.BackupId < 0) {
        postMessage({
            id: task.id,
            error: 'service/status_error',
        });

        return;
    }

    const _url = `${task.apiUrl}/service/copy/${task.BackupId}`;

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf']) {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    datacenter_id: task.params.dcToMove,
                };

                makeRequest(
                    _url,
                    'POST',
                    objToFormData(_post),
                    (jsonPost) => {
                        if (
                            jsonPost &&
                            jsonPost['status'] === 'ok' &&
                            jsonPost['service'] &&
                            jsonPost['service']['service_id']
                        ) {
                            task.CopyBackupId = parseInt(jsonPost['service']['service_id'], 10);

                            if (isNaN(task.CopyBackupId) || task.CopyBackupId < 0) {
                                postMessage({
                                    id: task.id,
                                    error: 'service/status_error',
                                });

                                return;
                            }

                            postMessage({
                                id: task.id,
                                status: 'request/status_processing',
                                CopyBackupId: task.CopyBackupId,
                            });

                            task.LastError = null;
                            task.FailedTryCount = 0;

                            copyBackupStatus(task);
                        } else {
                            errorHandler(task, copyBackup)(jsonPost);
                        }
                    },
                    errorHandler(task, copyBackup)
                );
            } else {
                errorHandler(task, copyBackup)(json);
            }
        },
        errorHandler(task, copyBackup)
    );
};

//=====================================================================================================================
// check status of copying backup process
//=====================================================================================================================
const copyBackupStatus = (task: CloneVdsTask) => {
    if (isNaN(task.CopyBackupId) || !task.CopyBackupId || task.CopyBackupId < 0) {
        postMessage({
            id: task.id,
            error: 'service/status_error',
        });

        return;
    }

    let _url = `${task.apiUrl}/service/list?ServiceSearch[service_id]=${task.CopyBackupId}`;

    makeRequest(
        _url,
        'GET',
        null,
        (jsonGet) => {
            let _backup = null;

            if (
                jsonGet &&
                jsonGet.status === 'ok' &&
                jsonGet.rows &&
                jsonGet.rows.length &&
                jsonGet.rows[0] &&
                jsonGet.rows[0]['service_id']
            ) {
                _backup = jsonGet.rows[0];
                task.LastError = null;
                task.FailedTryCount = 0;

                if (_backup.service_status === 'active') {
                    postMessage({
                        id: task.id,
                        step: 'server/create_title',
                        status: 'request/type_unblock',
                    });

                    createVds(task);
                } else if (_backup.service_status === 'error') {
                    postMessage({
                        id: task.id,
                        error: 'service/status_error',
                    });
                } else {
                    postMessage({
                        id: task.id,
                        status: _backup.service_status_text || 'request/status_processing',
                    });

                    restartProcess(task, copyBackupStatus);
                }
            } else {
                errorHandler(task, copyBackupStatus)(jsonGet);
            }
        },
        errorHandler(task, copyBackupStatus)
    );
};

//=====================================================================================================================
// create VDS
//=====================================================================================================================
const createVds = (task: CloneVdsTask) => {
    if (!isNaN(task.CreateVdsId) && task.CreateVdsId > 0) return;

    let _backupId = -1;
    if (!isNaN(task.BackupId) && task.BackupId > 0) _backupId = task.BackupId;
    if (!isNaN(task.CopyBackupId) && task.CopyBackupId > 0) _backupId = task.CopyBackupId;

    if (isNaN(_backupId) || !_backupId || _backupId < 0) {
        postMessage({
            id: task.id,
            error: 'service/status_error',
        });

        return;
    }

    const _url = `${task.apiUrl}/service/create/1`;

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf'] && json['model'] && json['status'] === 'form' && json['fields']) {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    backup_id: _backupId,
                    plan_group_id: task.params.plgrp,
                    plan_id: task.params.pl,
                    datacenter_id: task.params.dcToMove ? task.params.dcToMove : task.params.dc,
                    backup_auto: 0,
                };

                if (task.params.acc) {
                    _post[json['model']]['account_id'] = task.params.acc;
                } else {
                    if (json['fields'] && json['fields']['account_id'] && json['fields']['account_id']['value']) {
                        _post[json['model']]['account_id'] = json['fields']['account_id']['value'];
                    }
                }

                if (task.params.vdsPlanParams) {
                    _post[json['model']]['params'] = {};
                    _post[json['model']]['params']['cpu'] = task.params.plPrms.cpu;
                    _post[json['model']]['params']['ram'] = task.params.plPrms.ram;
                    _post[json['model']]['params']['disk'] = task.params.plPrms.disk;
                    _post[json['model']]['params']['ip4'] = task.params.plPrms.ip4;
                }

                makeRequest(
                    _url,
                    'POST',
                    objToFormData(_post),
                    (jsonPost) => {
                        if (
                            jsonPost &&
                            jsonPost['status'] === 'ok' &&
                            jsonPost['service'] &&
                            jsonPost['service']['service_id']
                        ) {
                            task.CreateVdsId = parseInt(jsonPost['service']['service_id'], 10);

                            if (isNaN(task.CreateVdsId) || task.CreateVdsId < 0) {
                                postMessage({
                                    id: task.id,
                                    error: 'service/status_error',
                                });

                                return;
                            }

                            postMessage({
                                id: task.id,
                                status: 'request/status_processing',
                                CreateVdsId: task.CreateVdsId,
                            });

                            task.LastError = null;
                            task.FailedTryCount = 0;

                            createVdsStatus(task);
                        } else {
                            errorHandler(task, createVds)(jsonPost);
                        }
                    },
                    errorHandler(task, createVds)
                );
            } else {
                errorHandler(task, createVds)(json);
            }
        },
        errorHandler(task, createVds)
    );
};

//=====================================================================================================================
// check status of copying backup process
//=====================================================================================================================
const createVdsStatus = (task: CloneVdsTask) => {
    if (isNaN(task.CreateVdsId) || !task.CreateVdsId || task.CreateVdsId < 0) {
        postMessage({
            id: task.id,
            error: 'service/status_error',
        });

        return;
    }

    let _url = `${task.apiUrl}/service/list?ServiceSearch[service_id]=${task.CreateVdsId}`;

    makeRequest(
        _url,
        'GET',
        null,
        (jsonGet) => {
            let _server = null;

            if (
                jsonGet &&
                jsonGet.status === 'ok' &&
                jsonGet.rows &&
                jsonGet.rows.length &&
                jsonGet.rows[0] &&
                jsonGet.rows[0]['service_id']
            ) {
                _server = jsonGet.rows[0];
                task.LastError = null;
                task.FailedTryCount = 0;

                if (_server.service_status === 'active') {
                    if (task.params.hl) {
                        postMessage({
                            id: task.id,
                            finish: true,
                        });
                    } else {
                        postMessage({
                            id: task.id,
                            step: 'service/deleting_backup',
                            status: 'request/type_unblock',
                        });

                        deleteBackups(task);
                    }
                } else if (_server.service_status === 'error') {
                    postMessage({
                        id: task.id,
                        error: 'service/status_error',
                    });
                } else {
                    postMessage({
                        id: task.id,
                        status: _server.service_status_text || 'request/status_processing',
                    });

                    restartProcess(task, createVdsStatus);
                }
            } else {
                errorHandler(task, createVdsStatus)(jsonGet);
            }
        },
        errorHandler(task, createVdsStatus)
    );
};

//=====================================================================================================================
// delete all backups
//=====================================================================================================================
const deleteBackups = (task: CloneVdsTask) => {
    let _deleteStarted = false;

    if (task.BackupId > 0) {
        _deleteStarted = true;
        const _url = `${task.apiUrl}/service/delete/${task.BackupId}`;

        makeRequest(
            _url,
            'GET',
            null,
            (json) => {
                if (json && json['_csrf']) {
                    const _post = { _csrf: json['_csrf'] };

                    makeRequest(
                        _url,
                        'POST',
                        objToFormData(_post),
                        (jsonPost) => {
                            if (
                                jsonPost &&
                                jsonPost['status'] === 'ok' &&
                                jsonPost['request'] &&
                                jsonPost['request']['request_id']
                            ) {
                                task.BackupId = -1;

                                setTimeout(() => {
                                    if (task.CopyBackupId < 0) {
                                        postMessage({
                                            id: task.id,
                                            finish: true,
                                        });
                                    }
                                }, 1000);
                            } else {
                                errorHandler(task, deleteBackups)(jsonPost);
                            }
                        },
                        errorHandler(task, deleteBackups)
                    );
                } else {
                    errorHandler(task, deleteBackups)(json);
                }
            },
            errorHandler(task, deleteBackups)
        );
    }

    if (task.CopyBackupId > 0) {
        _deleteStarted = true;
        const _url = `${task.apiUrl}/service/delete/${task.CopyBackupId}`;

        makeRequest(
            _url,
            'GET',
            null,
            (json) => {
                if (json && json['_csrf']) {
                    const _post = { _csrf: json['_csrf'] };

                    makeRequest(
                        _url,
                        'POST',
                        objToFormData(_post),
                        (jsonPost) => {
                            if (
                                jsonPost &&
                                jsonPost['status'] === 'ok' &&
                                jsonPost['request'] &&
                                jsonPost['request']['request_id']
                            ) {
                                task.CopyBackupId = -1;

                                setTimeout(() => {
                                    if (task.BackupId < 0) {
                                        postMessage({
                                            id: task.id,
                                            finish: true,
                                        });
                                    }
                                }, 1000);
                            } else {
                                errorHandler(task, deleteBackups)(jsonPost);
                            }
                        },
                        errorHandler(task, deleteBackups)
                    );
                } else {
                    errorHandler(task, deleteBackups)(json);
                }
            },
            errorHandler(task, deleteBackups)
        );
    }

    if (!_deleteStarted) {
        postMessage({
            id: task.id,
            finish: true,
        });
    }
};

//=====================================================================================================================
// process Clone VDS task in each tick of timer
//=====================================================================================================================
const processCloneTask = (task: CloneVdsTask) => {
    if (!task) return;

    // 1. Create backup
    if (task.step === 'service/creating_backup') {
        if (task.status === 'request/type_unblock') {
            createBackup(task);
        } else {
            restartProcess(task, createBackupStatus);
        }
    }

    // 2. Copu backup to DC
    if (task.step === 'backup/copy') {
        if (task.status === 'request/type_unblock') {
            copyBackup(task);
        } else {
            restartProcess(task, copyBackupStatus);
        }
    }

    // 3. Create VDS
    if (task.step === 'server/create_title') {
        if (task.status === 'request/type_unblock') {
            createVds(task);
        } else {
            restartProcess(task, createVdsStatus);
        }
    }

    // 4. Delete backups
    if (task.step === 'service/deleting_backup') {
        deleteBackups(task);
    }
};

//=====================================================================================================================
//
// Common functions
//
//=====================================================================================================================
// makes GET request (not used Promises - for max compatibility with browsers)
//=====================================================================================================================
const makeRequest = (
    url: string,
    method: 'GET' | 'POST',
    data: FormData,
    callBackSuccess: (answer: any) => void,
    callBackFail: (error: string) => void
) => {
    const transport = new XMLHttpRequest();
    transport.timeout = 60000;
    transport.responseType = 'json';
    transport.withCredentials = true;

    transport.onreadystatechange = function () {
        if (transport.readyState === 4) {
            let jsonAnswer = null;
            if (transport.response) {
                jsonAnswer = transport.response;
            }
            callBackSuccess(jsonAnswer);
        }
    };

    transport.onerror = function () {
        callBackFail('request failed: ' + url);
    };

    transport.open(method, url, true);
    transport.send(method === 'GET' ? '' : data);
};

//=====================================================================================================================
// makes FormData based object
//=====================================================================================================================
const objToFormData = (obj: object, form?: FormData, namespace?: string): FormData => {
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
                objToFormData(obj[property], fd, formKey);
            } else {
                fd.append(formKey, obj[property]);
            }
        }
    }

    return fd;
};

//=====================================================================================================================
// error handler
//=====================================================================================================================
const errorHandler = (task: Task, continueFunction: Function) => {
    return (error: any) => {
        task.LastError = error;
        task.FailedTryCount++;

        if (task.FailedTryCount >= FailedTryCountMax) {
            task.FailedTryCount = FailedTryCountMax;
            postMessage({
                id: task.id,
                error: task.LastError,
            });
        } else {
            if (task.ErrorTimer) clearTimeout(task.ErrorTimer);
            if (task.ProcessTimer) clearTimeout(task.ProcessTimer);

            task.ErrorTimer = setTimeout(() => continueFunction(task), FailedTryPause);
        }
    };
};

//=====================================================================================================================
// process restarter
//=====================================================================================================================
const restartProcess = (task: Task, continueFunction: Function) => {
    if (task.ErrorTimer) clearTimeout(task.ErrorTimer);
    if (task.ProcessTimer) clearTimeout(task.ProcessTimer);

    task.ProcessTimer = setTimeout(() => continueFunction(task), 10000);
};

//=====================================================================================================================
// find task by ID in all lists
//=====================================================================================================================
const findTaskById = (id: number): boolean => {
    // 1. clone vds tasks
    if (CloneTasksList && CloneTasksList.length) {
        for (let idx in CloneTasksList) {
            const _task = CloneTasksList[idx];
            if (_task && _task.id === id) return true;
        }
    }

    // default answer
    return false;
};

//=====================================================================================================================
// remove task from list
//=====================================================================================================================
const removeTaskById = (id: number) => {
    // 1. clone vds tasks
    if (CloneTasksList && CloneTasksList.length) {
        for (let i = 0; i < CloneTasksList.length; i++) {
            const _task = CloneTasksList[i];

            if (_task && _task.id === id) {
                if (_task.ErrorTimer) {
                    clearTimeout(_task.ErrorTimer);
                    _task.ErrorTimer = null;
                }

                if (_task.ProcessTimer) {
                    clearTimeout(_task.ProcessTimer);
                    _task.ProcessTimer = null;
                }

                CloneTasksList.splice(i, 1);

                return;
            }
        }
    }
};

//=====================================================================================================================
// command to check current process
//=====================================================================================================================
const checkTaskById = (id: number) => {};

//=====================================================================================================================
// timer tick handler
//=====================================================================================================================
const timerTaskHandler = () => {
    /*
    // 1. clone vds tasks
    for (let idx in CloneTasksList) {
        let _task = CloneTasksList[idx];
        processCloneTask(_task);
    }

    // finally - restart timer
    Timer = setTimeout(timerTaskHandler, TimeOutInMinutes * 10000);
    */
};

//=====================================================================================================================
// start working worker (start timer)
//=====================================================================================================================
const startTimer = () => {
};

//=====================================================================================================================
// stop working worker (stop timer)
//=====================================================================================================================
const stopTimer = () => {
    const forDelete: number[] = [];

    // 1. clone vds tasks
    for (let idx in CloneTasksList) {
        let _task = CloneTasksList[idx];
        if (_task && _task.id) {
            forDelete.push(_task.id);
        }
    }

    // delete all stored
    forDelete.forEach(id => removeTaskById(id));
};

//=====================================================================================================================
//
// onMessage handler
//
//=====================================================================================================================
onmessage = (e) => {
    if (e.data === 'start') startTimer();
    else if (e.data === 'stop') stopTimer();
    //else if (typeof e.data === 'object' && e.data.task === 'check-service' && e.data.id) checkTaskById(e.data.id);
    else if (typeof e.data === 'object' && e.data.task === 'remove-task' && e.data.id) removeTaskById(e.data.id);
    else if (typeof e.data === 'object' && e.data.task && e.data.id && e.data.params && e.data.apiUrl) {
        if (e.data.task === 'clone-vds') createCloneTask(e.data);
    }
};

//=====================================================================================================================
