const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');
const {getWeather} = require('../utils');
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
  const svc = makeService({path: '/gemini'});
  const schema = require('../../app.json');

  svc.on('session:new', (session) => {
    const env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    const {to, from, direction} = session;
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    logger.info({env, to, from, direction}, `new incoming call: ${session.call_sid}`);

    const prompt = `${env.aiPrompt}\n\n${transferDescription}`;
    try {
      session
        .on('/event', onEvent.bind(null, session))
        .on('/toolCall', onToolCall.bind(null, session))
        .on('/final', onFinal.bind(null, session))
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session));

      session
        .answer()
        .pause({length: 1})
        .llm({
          vendor: 'google',
          model: env.model,
          auth: {
            apiKey: env.apiKey,
          },
          actionHook: '/final',
          eventHook: '/event',
          toolHook: '/toolCall',
          mcpServers: env.mcpServers?.split(',').trim().map((url) => ({url})) || [],
          llmOptions: {
            setup: {
              generationConfig: {
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: env.voice
                    }
                  }
                }
              },
              systemInstruction: {
                parts: [
                  {
                    text: prompt
                  }
                ]
              },
              tools: [
                /* example tool calling get_weather */
                {
                  functionDeclarations: [
                    {
                      name: 'get_weather',
                      description: 'Get the weather for a location',
                      parameters: {
                        type: 'object',
                        properties: {
                          location: {
                            type: 'string',
                            description: 'The location to get the weather for'
                          },
                          scale: {
                            type: 'string',
                            enum: ['celsius', 'fahrenheit'],
                            description: 'The scale to use for the temperature'
                          }
                        },
                        required: ['location']
                      }
                    },
                    {
                      name: 'transfer_call_to_agent',
                      description: 'Transfer the qualified lead to a specialist',
                      parameters: {
                        type: 'object',
                        properties: {
                          summary: {
                            type: 'string',
                            description: summaryDescription
                          }
                        },
                        required: ['summary']
                      }
                    }
                  ]
                }
              ]
            }
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

const onToolCall = async(session, evt) => {
  const {logger} = session.locals;

  logger.info({evt}, 'got toolHook ');
  const {function_calls, tool_call_id} = evt;

  const functionResponses = [];
  for (const functionCall of function_calls) {
    const {name, args, id} = functionCall;
    if (name === 'get_weather') {
      const {location, scale = 'celsius'} = args;
      try {
        const weather = await getWeather(location, scale, logger);
        logger.info({weather}, 'got response from weather API');
        functionResponses.push({
          response: {
            output: weather,
          },
          id,
        });
      } catch (err) {
        logger.info({err}, 'error getting weather');
        functionResponses.push({
          response: {
            output: {
              text: `Failed to get the weather for ${location}. Please try again later.`,
            },
          },
          id,
        });
      }
    }
    else if (name === 'transfer_call_to_agent') {
      const {summary} = args;
      logger.info({summary}, 'got summary from transfer_call_to_agent tool');
      functionResponses.push({
        response: {
          text: 'ok',
        },
        id,
      });
    }
    else {
      functionResponses.push({
        response: {
          text: 'ok',
        },
        id,
      });
    }
  }

  session.sendToolOutput(tool_call_id, {
    toolResponse: {
      functionResponses,
    }});
};

const onFinal = async(session, evt) => {
  const {logger} = session.locals;
  logger.info(`got actionHook: ${JSON.stringify(evt)}`);

  session
    .say({text: 'Sorry, your session has ended.'})
    .hangup()
    .reply();
};

const onEvent = async(session, evt) => {
  const {logger} = session.locals;
  logger.info(`got eventHook: ${JSON.stringify(evt)}`);
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  logger.info({code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.error({err}, `session ${session.call_sid} received error`);
};


module.exports = service;
