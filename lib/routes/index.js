module.exports = ({logger, makeService}) => {
  require('./gemini')({logger, makeService});
  require('./ultravox')({logger, makeService});
  require('./dial-specialist')({logger, makeService});
};

