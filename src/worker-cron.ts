//=====================================================================================================================
//
// Main worker - tasks starter
//
//=====================================================================================================================
// ts types/interfaces
//=====================================================================================================================
//import { Task } from './types';
// copied interface to here for bug reason: https://github.com/microsoft/TypeScript/issues/41513
interface Task {
    sourceId: string;
    innerId: number;
    task: 'request' | 'doubleRequest';
    schedule: string;
    url: string;
    params: any;
    readonly minutesPeriod: number;
    minutesLeft: number;
    readonly maxTries: number;
    currentTries: number;
    worker?: Worker;
    paramsConstructor?: string;
    successCondition?: Function;
    paramsForDoubleRequest?: any;
}

//=====================================================================================================================
// vars
//=====================================================================================================================
let timer = null;
const timeOut = 15000;
let tasksList: Array<Task> = [];

//=====================================================================================================================
// function parses schedule
//=====================================================================================================================
const parseSchedule = (schedule: string): number => {
    if (!schedule || !/^\d{1,2}['m'|'h'|'d']{1}$/i.test(schedule)) return -1;

    const modifierStr = schedule.slice(-1);
    const modifierNum = parseInt(schedule.slice(0, -1), 10);

    switch (modifierStr) {
        case 'm':
            return modifierNum;
        case 'h':
            return modifierNum * 60;
        case 'd':
            return modifierNum * 1440;
        default:
            return -1;
    }
};

//=====================================================================================================================
// create task based on given params
//=====================================================================================================================
const createTask = (params: any): boolean => {
    if (!params || !params.task) return false;
    if ((params.task === 'request' || params.task === 'doubleRequest') && !params.url) return false;

    const minutesPeriod = parseSchedule(params.schedule);
    if (minutesPeriod <= 0) return false;

    const {
        sourceId,
        innerId,
        task,
        schedule,
        url,
        maxTries,
        paramsConstructor,
        successCondition,
        paramsForDoubleRequest,
        ...data
    } = params;
    if (findTaskBySourceIdOrInnerId(String(sourceId), innerId)) return false;

    const newTask: Task = {
        sourceId: String(sourceId),
        innerId: innerId || Date.now(),
        task,
        schedule: schedule || '10m',
        url,
        minutesPeriod,
        minutesLeft: -1, // for first time start
        maxTries,
        currentTries: 0,
        params: data,
        worker: null,
        paramsConstructor: paramsConstructor || null,
        paramsForDoubleRequest: paramsForDoubleRequest || null,
    };

    if (successCondition && successCondition.length) {
        try {
            newTask.successCondition = new Function('data', successCondition);
        } catch (err) {
            newTask.successCondition = function (data) {
                return false;
            };
        }
    }

    addTask(newTask);
    return true;
};

//=====================================================================================================================
// find task by sourceId
//=====================================================================================================================
const findTaskBySourceIdOrInnerId = (sourceId: string, innerId: number) => {
    if (!tasksList || !tasksList.length) return null;
    return tasksList.find((t) => t && (t.sourceId === sourceId || t.innerId === innerId));
};

//=====================================================================================================================
// add task to list
//=====================================================================================================================
const addTask = (task: Task) => {
    tasksList.push(task);
};

//=====================================================================================================================
// remove task from list
//=====================================================================================================================
const removeTaskById = (id: number) => {
    tasksList = tasksList.filter((item) => {
        if (item && item.innerId && item.innerId === id) {
            item.innerId = -1;
            if (item.worker && item.worker.terminate) item.worker.terminate();
            return false;
        }

        return true;
    });
};

//=====================================================================================================================
// timer tick handler
//=====================================================================================================================
const timerTask = (isFirstTime = false) => {
    console.log('-------------- cron worker tick');
    // start all tasks
    for (let idx in tasksList) {
        const task = tasksList[idx];
        if (!task || task.innerId < 0) continue;

        console.log(JSON.stringify(task, null, 2));

        if (!isFirstTime) task.minutesLeft++;

        if (task.minutesLeft !== 0 && task.minutesLeft < task.minutesPeriod) continue;

        // need to start task
        task.currentTries++;
        if (!isFirstTime) task.minutesLeft = 0;

        if (task.task === 'doubleRequest') {
            // create worker for task
            task.worker = new Worker('worker-double-request.js?_=' + Date.now());

            // message handler
            task.worker.onmessage = (e) => {
                let _taskId = 0;
                if ('taskId' in e.data) _taskId = e.data.taskId;

                // find task
                const _task = tasksList.find((t) => t && t.innerId === _taskId);
                if (_task) {
                    // success condition
                    let isSuccessCondition = false;
                    if (_task.successCondition && typeof _task.successCondition === 'function') {
                        isSuccessCondition = _task.successCondition(e.data.answer);
                        if (isSuccessCondition) {
                            postMessage({
                                sourceId: _task.sourceId,
                                status: 'requested',
                                answer: e.data.answer,
                            });
                        }
                    }

                    // kill this task
                    let isNeedToKillTask = false;
                    if (_task.currentTries >= _task.maxTries) isNeedToKillTask = true;

                    if (isSuccessCondition || isNeedToKillTask) {
                        _task.innerId = -1;
                        if (_task.worker && _task.worker.terminate) _task.worker.terminate();
                        postMessage({
                            sourceId: _task.sourceId,
                            status: 'failed',
                            answer: e.data.answer,
                            error: e.data.error,
                        });
                    }
                }
            };

            // start task
            task.worker.postMessage({
                id: task.innerId,
                url: task.url,
                withCredentials: task.params.withCredentials,
                paramsConstructor: task.paramsConstructor,
                taskParams: task.paramsForDoubleRequest,
            });
        }
    }

    // filter for finished tasks
    tasksList = tasksList.filter((item) => item && item.innerId > 0);

    // finally - restart timer
    timer = setTimeout(timerTask, timeOut);
};

//=====================================================================================================================
// start working worker (start timer)
//=====================================================================================================================
const startTimer = () => {
    if (timer) stopTimer();
    timerTask(true);
};

//=====================================================================================================================
// stop working worker (stop timer)
//=====================================================================================================================
const stopTimer = () => {
    clearTimeout(timer);
    timer = null;
};

//=====================================================================================================================
// onMessage handler
//=====================================================================================================================
onmessage = (e) => {
    if (e.data === 'start') startTimer();
    else if (e.data === 'stop') stopTimer();
    else if (typeof e.data === 'object' && e.data.task === 'remove-task') removeTaskById(e.data.id);
    else if (typeof e.data === 'object' && e.data.task) createTask(e.data);
};

//=====================================================================================================================
