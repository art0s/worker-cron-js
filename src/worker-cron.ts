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
    // task's ID
    id: number;
    // command - what to do
    task: 'remove-task' | 'clone-vds';
    // worker
    worker: Worker | null;
}

interface CloneVdsTask extends Task {
    apiUrl: string;
    params: any;
    minutesLeft: number;
}

//=====================================================================================================================
// vars
//=====================================================================================================================
let Timer = null;
const TimeOut = 60000;
let TasksList: Array<CloneVdsTask> = [];

//=====================================================================================================================
// find task by ID
//=====================================================================================================================
const findTaskById = (id: number): boolean => {
    if (!TasksList || !TasksList.length) return false;
    return TasksList.some((t) => t && t.id === id);
};

//=====================================================================================================================
// function parses schedule
//=====================================================================================================================
const parseSchedule = (schedule: string): number => {
    if (!schedule || !/^\d{1,2}['m'|'h']{1}$/i.test(schedule)) return -1;

    const modifierStr = schedule.slice(-1);
    const modifierNum = parseInt(schedule.slice(0, -1), 10);

    switch (modifierStr) {
        case 'm':
            return modifierNum;
        case 'h':
            return modifierNum * 60;
        default:
            return -1;
    }
};

//=====================================================================================================================
// create task based on given params
//=====================================================================================================================
const createTask = (data: any) => {
    if (!data || !data.task || !data.id) return;

    const { id, task, params, apiUrl, step, status } = data;
    console.log('============ create task', id, findTaskById(id))
    if (findTaskById(id)) return;

    const newTask: CloneVdsTask = {
        id,
        task,
        params,
        apiUrl,
        minutesLeft: 0,
        worker: null,
    };

    if (newTask.task === 'clone-vds') {
        TasksList.push(newTask);
        newTask.worker = new Worker('worker-clone-vds.js?_=' + Date.now());
        newTask.worker.onmessage = (e) => {
            let _taskId = -1;
            if (e.data && 'id' in e.data) _taskId = parseInt(e.data.id, 10);
            if (isNaN(_taskId) || _taskId < 0) return;

            const _task = TasksList.find((t) => t && t.id === _taskId);
            if (!_task) return;

            if (e.data.finish || e.data.error) {
                removeTaskById(_taskId);
            }

            postMessage(e.data);
        };

        newTask.worker.postMessage({
            id: newTask.id,
            params: newTask.params,
            apiUrl: newTask.apiUrl,
            step,
            status,
            CreateVdsId: !isNaN(data.CreateVdsId) && data.CreateVdsId > 0 ? data.CreateVdsId : -1,
            CopyBackupId: !isNaN(data.CopyBackupId) && data.CopyBackupId > 0 ? data.CopyBackupId : -1,
            BackupId: !isNaN(data.BackupId) && data.BackupId > 0 ? data.BackupId : -1,
        });
    }
};

//=====================================================================================================================
// remove task from list
//=====================================================================================================================
const removeTaskById = (id: number) => {
    if (!TasksList || !TasksList.length) return;

    for (let i = 0; i < TasksList.length; i++) {
        const task = TasksList[i];

        if (task && task.id === id) {
            if (task.worker && task.worker.terminate) {
                task.worker.terminate();
            }

            TasksList.splice(i, 1);
            return;
        }
    }
};

//=====================================================================================================================
// command to check current process
//=====================================================================================================================
const checkTaskProcess = (id: number) => {
    if (!TasksList || !TasksList.length) return;

    for (let idx in TasksList) {
        let task = TasksList[idx];

        if (task && task.worker && task.worker.postMessage) {
            task.worker.postMessage({
                id,
                params: 'check-service',
                apiUrl: 'mock',
                step: 'mock',
                status: 'mock',
            });
        }
    }
};

//=====================================================================================================================
// timer tick handler
//=====================================================================================================================
const timerTaskHandler = () => {
    const forDelete: number[] = [];

    for (let idx in TasksList) {
        let task = null;
        if (TasksList[idx] && TasksList[idx].task === 'clone-vds') {
            task = TasksList[idx] as CloneVdsTask;
        }

        task.minutesLeft++;

        if (task.minutesLeft > 60 * 3) {
            forDelete.push(task.id);
        }
    }

    for (let i = 0; i < forDelete.length; i++) {
        removeTaskById(forDelete[i]);
    }

    // finally - restart timer
    Timer = setTimeout(timerTaskHandler, TimeOut);
};

//=====================================================================================================================
// start working worker (start timer)
//=====================================================================================================================
const startTimer = () => {
    if (Timer) stopTimer();
    timerTaskHandler();
};

//=====================================================================================================================
// stop working worker (stop timer)
//=====================================================================================================================
const stopTimer = () => {
    clearTimeout(Timer);
    Timer = null;
};

//=====================================================================================================================
// onMessage handler
//=====================================================================================================================
onmessage = (e) => {
    if (e.data === 'start') startTimer();
    else if (e.data === 'stop') stopTimer();
    else if (typeof e.data === 'object' && e.data.task === 'check-service' && e.data.id) checkTaskProcess(e.data.id);
    else if (typeof e.data === 'object' && e.data.task === 'remove-task' && e.data.id) removeTaskById(e.data.id);
    else if (typeof e.data === 'object' && e.data.task && e.data.id && e.data.params && e.data.apiUrl)
        createTask(e.data);
};

//=====================================================================================================================
