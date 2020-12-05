/**
 * A Service that determines whether an IP address is valid
 */
import { Service, Task, TaskResult, TaskService } from '../taskServices';
import { validateIP } from '../utils';

/**
 * IP Validation Task Service
 *
 * NOTE: Currently only supports IPv4
 */
@Service({
  name: 'ip-validation',
  description: 'Determine whether a string is a valid IPv4 address',
  returnType: typeof Boolean,
  requiredData: {
    ip: 'string'
  }
})
export default class IPValidationService extends TaskService {
  /**
   * Process a given task
   */
  processTask = (task: Task): Promise<TaskResult> => {
    const { id, data } = task;
    const { ip } = data;

    const valid = validateIP(ip);

    return Promise.resolve(new TaskResult(id, 'done', { data: { valid } }));
  };
}
