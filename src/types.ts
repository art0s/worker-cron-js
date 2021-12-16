export interface Task {
    innerId: number;
    task: 'request' | 'doubleRequest' | 'callback';
    schedule: string;
    params: any;
    url?: string;
    callback?: (params: any) => any;
    minutesLeft: number;
}