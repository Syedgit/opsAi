import { parseTaskReply } from '../evidence';

describe('parseTaskReply', () => {
  it.each([
    ['3', 3, ''],
    ['#3', 3, ''],
    ['task 3', 3, ''],
    ['Task 3 done', 3, 'done'],
    ['2 38F', 2, '38F'],
    ['2: 38F', 2, '38F'],
    ['2) fridge is 38', 2, 'fridge is 38'],
    ['12 done', 12, 'done'],
  ])('reads %j as task %i with proof %j', (text, code, rest) => {
    expect(parseTaskReply(text)).toEqual({ code, rest });
  });

  it.each(['thanks', 'done', '', '3.5 gallons', '1000 dollars', '2x4 boards', 'two cases'])('does not treat %j as a task number', (text) => {
    expect(parseTaskReply(text).code).toBeNull();
  });
});
