import { Service, Task, TaskResult, TaskResultStatuses, TaskService } from '../taskServices';

@Service({
  name: 'mock-worker',
  description: 'Mock job queue worker results',
  returnType: typeof Boolean,
  requiredData: {
    mockResult: 'string'
  }
})
export default class JobWorkerMock extends TaskService {
  protected processTask = (task: Task): Promise<TaskResult> => {
    const { data, id, requestId } = task;
    const { mockResult } = data;

    const isValid = TaskResultStatuses.includes(mockResult);

    const returnData = isValid
      ? { data: { mockResult: mockResult } }
      : { error: `Passed invalid mockResult '${mockResult}'. Must be one of: ${TaskResultStatuses.toString()}.` };

    if ('fail' === mockResult) {
      throw new Error('mock-worker failing as directed');
    }

    const status = isValid ? mockResult : 'reject';

    return Promise.resolve(new TaskResult(id, requestId, status, returnData));
  };
}
