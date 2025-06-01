# ultravox-warm-transfer

> Note: This application requires jambonz 0.9.4 or above

This application illustrates how to do a warm transfer with ultravox.  The call flow is:
- an inbound or outbound call is connected to ultravox
- a client tool is provided to ultravox to perform the call transfer
- ultravox calls the tool to transfer the call and provides a conversation summary
- the call is momentarily placed in a queue and an outdial is made to the human agent
- text-to-speech is used to play the conversation summary to the agent, then the agent is connected to the caller

This application illustrates the use of environment variables in jambonz (requires 0.9.4 or above).  The following variables can be configured in the jambonz portal when provisioning this app:
- your ultravox api key
- the prompt, or system instructions; you can supply this from a text file containing your prompt
- the agent phone number or sip user to transfer to (to transfer to a phone number simply enter the number; to transfer to a registered sip user enter "user:daveh@foo.jambonz.cloud" or similar)
- the Carrier or SIP trunk on jambonz to use to call the agent if a phone number is used
- the caller id to use on the outbound call to the agent (optional)
- a list of MCP servers containing tools that you want to expose to your ultravox application (optional)








