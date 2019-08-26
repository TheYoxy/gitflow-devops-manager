import 'jasmine';
import {Repository} from '../repository';

describe('Repository', () => {
  it('should not build', async () => {
    await expectAsync(Repository.create('', '', '')).toBeRejected();
  });
  it('should fail', () => {
    expect(true).toBe(false);
  });
});
