/**
 * Service to get RDAP information for a domain
 */
import { Service, Task, TaskResult, TaskService } from '../taskServices';

@Service({
  description: 'Lookup RDAP information for a domain or IP address',
  name: 'rdap',
  requiredData: {
    oneOf: [
      {
        ip: 'string',
        domain: 'string'
      }
    ]
  },
  returnType: typeof Boolean
})
export default class RDAPService extends TaskService {
  protected processTask = (task: Task): Promise<TaskResult> => {
    const { id, requestId } = task;

    const resultData = { data: { WIP: 'works!' } }; // TEMP shim
    const status = 'done'; // TEMP shim

    const returnTask: TaskResult = {
      id,
      requestId,
      resultData,
      status
    };
    return Promise.resolve(returnTask); // TEMP shim
  };
}
