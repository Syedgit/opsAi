import { ClassificationType } from '@prisma/client';
import { GREETING_REPLY, NO_DATA_REPLY, routeIntent } from '../intent';

describe('routeIntent: execute without AI', () => {
  it('treats OK/HELP as commands', () => {
    expect(routeIntent({ text: 'OK', hasMedia: false, isCommand: true })).toEqual({ layer: 'execute', action: 'command' });
  });

  it('ignores voice notes', () => {
    expect(routeIntent({ text: '', hasMedia: true, isAudio: true })).toEqual({ layer: 'execute', action: 'ignore_audio' });
  });

  it('stays quiet for thanks and emoji', () => {
    expect(routeIntent({ text: 'thanks', hasMedia: false })).toMatchObject({ layer: 'execute', action: 'chatter', reply: null });
  });

  it('greets without a model', () => {
    expect(routeIntent({ text: 'good morning', hasMedia: false })).toMatchObject({
      layer: 'execute',
      action: 'chatter',
      reply: GREETING_REPLY,
    });
  });

  it('does not send chatter to the AI', () => {
    expect(routeIntent({ text: 'who is working tomorrow', hasMedia: false })).toMatchObject({
      layer: 'execute',
      action: 'no_data',
      reply: NO_DATA_REPLY,
    });
  });

  it('runs labeled cash/card through the number rules, not the model', () => {
    const intent = routeIntent({ text: 'Daily sales cash 2100 card 5400', hasMedia: false });
    expect(intent).toMatchObject({
      layer: 'execute',
      action: 'rules',
      type: ClassificationType.STORE_SALES,
      fields: { cash: 2100, card: 5400 },
    });
  });
});

describe('routeIntent: one AI read only when code cannot finish the job', () => {
  it('sends photos to the model', () => {
    expect(routeIntent({ text: '', hasMedia: true })).toEqual({ layer: 'reason', why: 'photo' });
    expect(routeIntent({ text: 'thanks', hasMedia: true })).toEqual({ layer: 'reason', why: 'photo' });
  });

  it('sends invoices to the model so a due date can become a code reminder', () => {
    expect(routeIntent({ text: 'unpaid Pepsi invoice 850 due 11/28', hasMedia: false })).toEqual({
      layer: 'reason',
      why: 'invoice',
    });
  });

  it('sends a close that also has gas/deposit/payouts to the model', () => {
    expect(routeIntent({ text: 'Rockaway cash 106 card 334 gas 1355 Lays 142 deposit 1653', hasMedia: false })).toEqual({
      layer: 'reason',
      why: 'leftover_numbers',
    });
  });

  it('sends equipment problems to the model', () => {
    expect(routeIntent({ text: 'the ice machine is broken', hasMedia: false })).toEqual({
      layer: 'reason',
      why: 'equipment_or_unknown',
    });
  });

  it('sends a typed order list to the model so the vendor can be confirmed', () => {
    expect(routeIntent({ text: 'need 10 Marlboro Red and 5 Newport from HLA', hasMedia: false })).toEqual({
      layer: 'reason',
      why: 'order',
    });
  });

  it('does not treat "out of order" as a restock list', () => {
    expect(routeIntent({ text: 'pump 3 is out of order', hasMedia: false })).toEqual({
      layer: 'reason',
      why: 'equipment_or_unknown',
    });
  });
});
