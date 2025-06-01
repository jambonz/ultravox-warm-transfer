const { parseDestination } = require('../utils');
const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');
const transferDescription = `When transferring the call to a specialist, 
FIRST inform them that you are transferring them to a specialist, 
and ONLY THEN, after you finish speaking, invoke the transfer_call_to_agent tool.
Do not say anything else after invoking the tool.`;

const summaryDescription = `
  A brief summary of the conversation.
  The summary should be no more than 100 words.  If the caller provided their name, include it in the summary.
  Highlight their interests and needs as well as any specific concerns they may have stated.  If they 
  are interested in a specific product or service, include that in the summary. Do not speak the summary`;

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/ultravox'});
  const schema = require('../../app.json');

  svc.on('session:new', (session) => {
    const env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    const {to, from, direction} = session;
    session.locals = {
      logger: logger.child({call_sid: session.call_sid}),
      transferTrunk: env.transferTrunk,
      transferNumber: env.transferNumber,
      callerId: env.callerId
    };
    logger.info({env, to, from, direction, session}, `new incoming call: ${session.call_sid}`);

    const prompt = `${env.aiPrompt}\n\n${transferDescription}`;
    try {
      session
        .on('/event', onEvent.bind(null, session))
        .on('/final', onFinal.bind(null, session))
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session))
        .on('/toolCall', onToolCall.bind(null, session));

      session
        .answer()
        .pause({length: 1})
        .llm({
          vendor: 'ultravox',
          model: 'fixie-ai/ultravox',
          auth: {
            apiKey: env.apiKey,
          },
          actionHook: '/final',
          eventHook: '/event',
          toolHook: '/toolCall',
          mcpServers: env.mcpServers?.split(',').trim().map((url) => ({url})) || [],
          llmOptions: {
            systemPrompt: prompt,
            firstSpeaker: 'FIRST_SPEAKER_USER',
            initialMessages: [
              {
                medium: 'MESSAGE_MEDIUM_VOICE',
                role: 'MESSAGE_ROLE_USER'
              }
            ],
            model: 'fixie-ai/ultravox',
            voice: 'Tanya-English',
            transcriptOptional: true,
            selectedTools: [
              {
                temporaryTool: {
                  modelToolName: 'call-transfer',
                  description: 'Transfers the call to a specialist',
                  dynamicParameters: [
                    {
                      name: 'conversation_summary',
                      location: 'PARAMETER_LOCATION_BODY',
                      schema: {
                        type: 'string',
                        description: summaryDescription
                      },
                      required: true
                    }
                  ],
                  client: {}
                }
              }
            ],
          }
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onEvent = async(session, evt) => {
  const {logger} = session.locals;
  logger.info(`got eventHook: ${JSON.stringify(evt)}`);
};

const onFinal = async(session, evt) => {
  const {logger} = session.locals;
  logger.info(`got actionHook: ${JSON.stringify(evt)}`);

  if (['server failure', 'server error'].includes(evt.completion_reason)) {
    if (evt.error.code === 'rate_limit_exceeded') {
      let text = 'Sorry, you have exceeded your  rate limits. ';
      const arr = /try again in (\d+)/.exec(evt.error.message);
      if (arr) {
        text += `Please try again in ${arr[1]} seconds.`;
      }
      session
        .say({text});
    }
    else {
      session
        .say({text: 'Sorry, there was an error processing your request.'});
    }
    session.hangup();
  }
  session.reply();
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

const onToolCall = async(session, evt) => {
  const {logger, callerId, transferTrunk, transferNumber} = session.locals;
  const {name, args, tool_call_id} = evt;
  const {conversation_summary} = args;
  logger.info({evt}, `got toolHook for ${name} with tool_call_id ${tool_call_id}`);

  session.locals.conversation_summary = conversation_summary;

  try {
    const data = {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      result: 'Successfully initiated transfer to specialist.',
    };
    session.sendToolOutput(tool_call_id, data);

    /* queue the caller */
    session
      .say({text: 'Please hold while we connect you to a specialist.'})
      .enqueue({
        name: session.call_sid,
        actionHook: '/consultationDone'
      })
      .send();

    /* dial the specialist */
    const to = parseDestination(transferNumber, transferTrunk);
    session.sendCommand('dial', {
      call_hook: '/dial-specialist',
      from: callerId || session.from,
      to,
      tag: {
        conversation_summary,
        queue: session.call_sid
      },
      speech_synthesis_vendor: 'google',
      speech_synthesis_language: 'en-US',
      speech_synthesis_voice: 'en-US-Wavenet-C',
      speech_recognizer_vendor: 'deepgram',
      speech_recognizer_language: 'en-US'
    });


  } catch (err) {
    logger.info({err}, 'error transferring call');
    const data = {
      type: 'client_tool_result',
      invocation_id: tool_call_id,
      error_message: 'Failed to transfer call'
    };
    session.sendToolOutput(tool_call_id, data);
  }
};

module.exports = service;
