ARG NODE_VERSION=20.10

FROM node:${NODE_VERSION}

ARG APP_HOME=/app
ARG USERNAME=node

# install some packages to use
RUN apt-get update \
  && apt-get -y install --no-install-recommends \
  # other
  curl \
  vim

# Create a non-root user to use if preferred - see https://aka.ms/vscode-remote/containers/non-root-user.
RUN apt-get install --no-install-recommends -y \
  sudo \
  && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME\
  && chmod 0440 /etc/sudoers.d/$USERNAME

# 日本語が使えるようにする
ENV DEBIAN_FRONTEND noninteractive

RUN apt-get install -y locales
RUN locale-gen ja_JP.UTF-8

ENV LANG ja_JP.UTF-8
ENV LC_CTYPE ja_JP.UTF-8
RUN localedef -f UTF-8 -i ja_JP ja_JP.utf8

# cleaning up unused files
RUN apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
  && rm -rf /var/lib/apt/lists/*

WORKDIR ${APP_HOME}
COPY package.json ${APP_HOME}
COPY package-lock.json ${APP_HOME}
COPY tsconfig.json ${APP_HOME}
COPY .husky/ ${APP_HOME}/.husky/
COPY src/ ${APP_HOME}/src/
COPY scripts/ ${APP_HOME}/scripts/
RUN chown -R $USERNAME:$USERNAME ${APP_HOME}

USER $USERNAME
RUN npm install
RUN npm run build
