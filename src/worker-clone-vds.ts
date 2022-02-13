//=====================================================================================================================
//
// Clone VDS
//
//=====================================================================================================================
let CloneVdsId = null;
let Params = null;
let ApiUrl = '';
let FailedTryCount = 0;
const FailedTryCountMax = 100;
const FailedTryPause = 300000;
let LastError: any = null;
let CreateVdsId = -1;
let BackupId = -1;
let CopyBackupId = -1;
let ProcessTimer = 0;
let ErrorTimer = 0;
let IsCheckingStatus = false;

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
    transport.timeout = 5000;
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

    transport.open(method, ApiUrl + url, true);
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
const errorHandler = (continueFunction: Function) => {
    return (error: any) => {
        LastError = error;
        FailedTryCount++;

        if (FailedTryCount >= FailedTryCountMax) {
            FailedTryCount = FailedTryCountMax;
            postMessage({
                id: CloneVdsId,
                error: LastError,
            });
        } else {
            if (ErrorTimer) clearTimeout(ErrorTimer);
            ErrorTimer = setTimeout(continueFunction, FailedTryPause);
        }
    };
};

//=====================================================================================================================
// process restarter
//=====================================================================================================================
const restartProcess = (continueFunction: Function) => {
    if (ProcessTimer) clearTimeout(ProcessTimer);
    ProcessTimer = setTimeout(continueFunction, 30000);
};

//=====================================================================================================================
// starts clone of VDS
//=====================================================================================================================
const createBackup = () => {
    IsCheckingStatus = false;
    const _url = '/service/update/' + CloneVdsId;

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf'] && json['model'] && json['status'] === 'form') {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    backup_create: true,
                    reinstall: 0,
                };

                makeRequest(
                    _url,
                    'POST',
                    objToFormData(_post),
                    (jsonPost) => {
                        if (jsonPost && jsonPost['status'] === 'ok' && jsonPost['request']) {
                            postMessage({
                                id: CloneVdsId,
                                step: 'service/creating_backup',
                                status: 'request/status_processing',
                            });

                            LastError = null;
                            FailedTryCount = 0;

                            createBackupStatus();
                        } else {
                            errorHandler(createBackup)(jsonPost);
                        }
                    },
                    errorHandler(createBackup)
                );
            } else {
                errorHandler(createBackup)(json);
            }
        },
        errorHandler(createBackup)
    );
};

//=====================================================================================================================
// check status of creating backup process
//=====================================================================================================================
const createBackupStatus = () => {
    IsCheckingStatus = true;
    let _url = '/service/list?ServiceSearch[service_type_id]=15&ServiceSearch[parent_id]=' + CloneVdsId;
    if (BackupId > 0) {
        _url = '/service/list?ServiceSearch[service_id]=' + BackupId;
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
                    BackupId = _backup.service_id;
                    LastError = null;
                    FailedTryCount = 0;

                    if (_backup.service_status === 'active') {
                        if (Params.dcToMove) {
                            postMessage({
                                id: CloneVdsId,
                                step: 'backup/copy',
                                status: 'request/type_unblock',
                                BackupId,
                            });

                            copyBackup();
                        } else {
                            postMessage({
                                id: CloneVdsId,
                                step: 'server/create_title',
                                status: 'request/type_unblock',
                                BackupId,
                            });

                            createVds();
                        }
                    } else if (_backup.service_status === 'error') {
                        postMessage({
                            id: CloneVdsId,
                            error: 'service/status_error',
                        });
                    } else if (_backup.service_status_text) {
                        postMessage({
                            id: CloneVdsId,
                            status: _backup.service_status_text,
                            BackupId,
                        });

                        restartProcess(createBackupStatus);
                    }
                } else {
                    errorHandler(createBackupStatus)(jsonGet);
                }
            } else {
                errorHandler(createBackupStatus)(jsonGet);
            }
        },
        errorHandler(createBackupStatus)
    );
};

//=====================================================================================================================
// copy VDS to DC
//=====================================================================================================================
const copyBackup = () => {
    if (isNaN(BackupId) || !BackupId || BackupId < 0) {
        postMessage({
            id: CloneVdsId,
            error: 'service/status_error',
        });

        return;
    }

    IsCheckingStatus = false;
    const _url = '/service/copy/' + BackupId;

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf']) {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    datacenter_id: Params.dcToMove,
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
                            CopyBackupId = jsonPost['service']['service_id'];

                            postMessage({
                                id: CloneVdsId,
                                status: 'request/status_processing',
                                CopyBackupId,
                            });

                            LastError = null;
                            FailedTryCount = 0;

                            copyBackupStatus();
                        } else {
                            errorHandler(copyBackup)(jsonPost);
                        }
                    },
                    errorHandler(copyBackup)
                );
            } else {
                errorHandler(copyBackup)(json);
            }
        },
        errorHandler(copyBackup)
    );
};

//=====================================================================================================================
// check status of copying backup process
//=====================================================================================================================
const copyBackupStatus = () => {
    if (isNaN(CopyBackupId) || !CopyBackupId || CopyBackupId < 0) {
        postMessage({
            id: CloneVdsId,
            error: 'service/status_error',
        });

        return;
    }

    IsCheckingStatus = true;
    let _url = '/service/list?ServiceSearch[service_id]=' + CopyBackupId;

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
                LastError = null;
                FailedTryCount = 0;

                if (_backup.service_status === 'active') {
                    postMessage({
                        id: CloneVdsId,
                        step: 'server/create_title',
                        status: 'request/type_unblock',
                    });

                    createVds();
                } else if (_backup.service_status === 'error') {
                    postMessage({
                        id: CloneVdsId,
                        error: 'service/status_error',
                    });
                } else if (_backup.service_status_text) {
                    postMessage({
                        id: CloneVdsId,
                        status: _backup.service_status_text,
                    });

                    restartProcess(copyBackupStatus);
                }
            } else {
                errorHandler(copyBackupStatus)(jsonGet);
            }
        },
        errorHandler(copyBackupStatus)
    );
};

//=====================================================================================================================
// create VDS
//=====================================================================================================================
const createVds = () => {
    let _backupId = -1;
    if (BackupId > 0) _backupId = BackupId;
    if (CopyBackupId > 0) _backupId = CopyBackupId;

    if (isNaN(_backupId) || !_backupId || _backupId < 0) {
        postMessage({
            id: CloneVdsId,
            error: 'service/status_error',
        });

        return;
    }

    IsCheckingStatus = false;
    const _url = '/service/create/1';

    makeRequest(
        _url,
        'GET',
        null,
        (json) => {
            if (json && json['_csrf'] && json['model'] && json['status'] === 'form' && json['fields']) {
                const _post = { _csrf: json['_csrf'] };
                _post[json['model']] = {
                    backup_id: _backupId,
                    plan_group_id: Params.plgrp,
                    plan_id: Params.pl,
                    datacenter_id: Params.dcToMove ? Params.dcToMove : Params.dc,
                    backup_auto: 0,
                };

                if (Params.acc) {
                    _post[json['model']]['account_id'] = Params.acc;
                } else {
                    if (json['fields'] && json['fields']['account_id'] && json['fields']['account_id']['value']) {
                        _post[json['model']]['account_id'] = json['fields']['account_id']['value'];
                    }
                }

                if (Params.vdsPlanParams) {
                    _post[json['model']]['params'] = {};
                    _post[json['model']]['params']['cpu'] = Params.plPrms.cpu;
                    _post[json['model']]['params']['ram'] = Params.plPrms.ram;
                    _post[json['model']]['params']['disk'] = Params.plPrms.disk;
                    _post[json['model']]['params']['ip4'] = Params.plPrms.ip4;
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
                            CreateVdsId = jsonPost['service']['service_id'];

                            postMessage({
                                id: CloneVdsId,
                                status: 'request/status_processing',
                                CreateVdsId,
                            });

                            LastError = null;
                            FailedTryCount = 0;

                            createVdsStatus();
                        } else {
                            errorHandler(createVds)(jsonPost);
                        }
                    },
                    errorHandler(createVds)
                );
            } else {
                errorHandler(createVds)(json);
            }
        },
        errorHandler(createVds)
    );
};

//=====================================================================================================================
// check status of copying backup process
//=====================================================================================================================
const createVdsStatus = () => {
    if (isNaN(CreateVdsId) || !CreateVdsId || CreateVdsId < 0) {
        postMessage({
            id: CloneVdsId,
            error: 'service/status_error',
        });

        return;
    }

    IsCheckingStatus = true;
    let _url = '/service/list?ServiceSearch[service_id]=' + CreateVdsId;

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
                LastError = null;
                FailedTryCount = 0;

                if (_server.service_status === 'active') {
                    IsCheckingStatus = false;

                    if (Params.hl) {
                        postMessage({
                            id: CloneVdsId,
                            finish: true,
                        });
                    } else {
                        postMessage({
                            id: CloneVdsId,
                            step: 'service/deleting_backup',
                            status: 'request/type_unblock',
                        });

                        deleteBackups();
                    }
                } else if (_server.service_status === 'error') {
                    postMessage({
                        id: CloneVdsId,
                        error: 'service/status_error',
                    });
                } else if (_server.service_status_text) {
                    postMessage({
                        id: CloneVdsId,
                        status: _server.service_status_text,
                    });

                    restartProcess(createVdsStatus);
                }
            } else {
                errorHandler(createVdsStatus)(jsonGet);
            }
        },
        errorHandler(createVdsStatus)
    );
};

//=====================================================================================================================
// delete all backups
//=====================================================================================================================
const deleteBackups = () => {
    let _deleteStarted = false;

    if (BackupId > 0) {
        _deleteStarted = true;
        const _url = '/service/delete/' + BackupId;

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
                                BackupId = -1;

                                setTimeout(() => {
                                    if (CopyBackupId < 0) {
                                        postMessage({
                                            id: CloneVdsId,
                                            finish: true,
                                        });
                                    }
                                }, 1000);
                            } else {
                                errorHandler(deleteBackups)(jsonPost);
                            }
                        },
                        errorHandler(deleteBackups)
                    );
                } else {
                    errorHandler(deleteBackups)(json);
                }
            },
            errorHandler(deleteBackups)
        );
    }

    if (CopyBackupId > 0) {
        _deleteStarted = true;
        const _url = '/service/delete/' + CopyBackupId;

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
                                CopyBackupId = -1;

                                setTimeout(() => {
                                    if (BackupId < 0) {
                                        postMessage({
                                            id: CloneVdsId,
                                            finish: true,
                                        });
                                    }
                                }, 1000);
                            } else {
                                errorHandler(deleteBackups)(jsonPost);
                            }
                        },
                        errorHandler(deleteBackups)
                    );
                } else {
                    errorHandler(deleteBackups)(json);
                }
            },
            errorHandler(deleteBackups)
        );
    }

    if (!_deleteStarted) {
        postMessage({
            id: CloneVdsId,
            finish: true,
        });
    }
};

//=====================================================================================================================
// onMessage handler
//=====================================================================================================================
onmessage = (e) => {
    if (e.data && e.data.id && e.data.params && e.data.apiUrl && e.data.step && e.data.status) {
        if (e.data.params === 'check-service') {
            let func = null;
            if (e.data.id === BackupId) {
                func = createBackupStatus;
            } else if (e.data.id === CopyBackupId) {
                func = copyBackupStatus;
            } else if (e.data.id === CreateVdsId) {
                func = createVdsStatus;
            }

            if (IsCheckingStatus && func && typeof func === 'function') {
                if (ErrorTimer) {
                    clearTimeout(ErrorTimer);
                    ErrorTimer = 0;
                }

                if (ProcessTimer) {
                    clearTimeout(ProcessTimer);
                    ProcessTimer = 0;
                }

                func();
            }

            return;
        }

        CloneVdsId = e.data.id;
        Params = e.data.params;
        ApiUrl = e.data.apiUrl;

        CreateVdsId = !isNaN(e.data.CreateVdsId) && e.data.CreateVdsId > 0 ? e.data.CreateVdsId : -1;
        CopyBackupId = !isNaN(e.data.CopyBackupId) && e.data.CopyBackupId > 0 ? e.data.CopyBackupId : -1;
        BackupId = !isNaN(e.data.BackupId) && e.data.BackupId > 0 ? e.data.BackupId : -1;

        if (e.data.step === 'service/creating_backup') {
            if (e.data.status === 'request/type_unblock') {
                createBackup();
            } else {
                createBackupStatus();
            }
        }

        if (e.data.step === 'backup/copy') {
            if (e.data.status === 'request/type_unblock') {
                copyBackup();
            } else {
                copyBackupStatus();
            }
        }

        if (e.data.step === 'server/create_title') {
            if (e.data.status === 'request/type_unblock') {
                createVds();
            } else {
                createVdsStatus();
            }
        }

        if (e.data.step === 'service/deleting_backup') {
            deleteBackups();
        }
    }
};

//=====================================================================================================================
