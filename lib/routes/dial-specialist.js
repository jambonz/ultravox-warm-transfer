const service = ({logger, makeService}) => {
  const svc = makeService({path: '/dial-specialist'});

  svc.on('session:new', (session) => {
    session.locals = {
      logger: logger.child({call_sid: session.call_sid}),
    };
    const {conversation_summary, queue} = session.customerData;
    logger.info({session}, `new incoming request for rest dial: ${session.call_sid}`);

    try {
      session
        .on('/dequeue', onDequeue.bind(null, session))
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session));

      session
        .say({text: conversation_summary})
        .say({text: 'Now you will be connected to the caller.'})
        .dequeue({
          name: queue,
          beep: true,
          timeout: 2,
          actionHook: '/dequeue',
        })
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onDequeue = (session, evt) => {
  const {logger} = session.locals;
  logger.info({evt}, 'dequeue result');
  if (evt.dequeue_result === 'timeout') {
    logger.info('caller hung up, sending message to agent');
    session
      .say({text: 'I\'m sorry, the caller hung up.'})
      .hangup()
      .send();
  }
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

module.exports = service;
