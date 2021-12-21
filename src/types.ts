export interface Task {
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