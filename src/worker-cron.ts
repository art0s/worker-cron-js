//=====================================================================================================================
// ts types/interfaces
//=====================================================================================================================
//import { Task } from './types';
// copied interface to here for bug reason: https://github.com/microsoft/TypeScript/issues/41513
interface Task {
    innerId: number;
    task: 'request' | 'doubleRequest' | 'callback';
    schedule: string;
    params: any;
    url?: string;
    callback?: (params: any) => any;
    minutesLeft: number;
}

//=====================================================================================================================
// vars
//=====================================================================================================================
let timer = null;
const timeOut = 60000;
let tasksList: Array<Task> = [];

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
    if (parseSchedule(params.schedule) < 0) return false;
    if ((params.task === 'request' || params.task === 'doubleRequest') && !params.url) return false;
    if (params.task === 'callback' && !params.callback) return false;

    const { innerId, task, schedule, url, callback, ...data } = params;

    const newTask: Task = {
        innerId: innerId || Date.now(),
        schedule: schedule || '1m',
        minutesLeft: 0,
        task,
        url,
        callback,
        params: data,
    };

    addTask(newTask);
    return true;
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
const removeTask = (task: Task) => {
    tasksList = tasksList.filter((item) => item && item.innerId && item.innerId !== task.innerId);
};

//=====================================================================================================================
// timer tick handler
//=====================================================================================================================
const timerTask = (isFirstTime = false) => {
    // start all tasks
    tasksList.forEach((task) => {
        console.log(JSON.stringify(task, null, 2));
        if (!isFirstTime) task.minutesLeft++;

        let minutesStart = parseSchedule(task.schedule);
        if (task.minutesLeft === 0 || task.minutesLeft >= minutesStart) {
            console.log('start task!!!');
            if (!isFirstTime) task.minutesLeft = 0;
        }
    });

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
    else if (typeof e.data === 'object' && e.data.task === 'remove' && e.data.innerId) removeTask(e.data);
    else if (typeof e.data === 'object' && e.data.task) createTask(e.data);
};

//=====================================================================================================================
