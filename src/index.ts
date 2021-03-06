#! /usr/bin/env node

import { Answers, Question } from "inquirer";
import { IConfiguration, loadConfiguration } from "./configuration";
import { doInstall } from "./install";
import { createStory, getState, IClubhouseState, IEpic, IProject, ITeam, IStory, ILabel, ICreateLabel } from "./clubhouse";
import Chalk from "chalk";
import ChoiceOption = inquirer.objects.ChoiceOption;
import { isNullOrUndefined } from "util";
import inquirer = require("inquirer");
import slug = require("slug");
import { writeSync } from "clipboardy";

const link = (msg: string) => Chalk.blue(Chalk.underline(msg));

/**
 * The ILabelChoice is used to hold the selected label object
 */
interface ILabelChoice {
  name: string;
  value: ICreateLabel;
}

function createSingleTicket(state: IClubhouseState) {
  inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));
  const questions: Question[] = [
    {
      type: 'autocomplete',
      name: 'project',
      message: 'Which project does this story belong to: ',
      source: (answersSoFar: Answers[], input: string) => {
        const projects: ChoiceOption[] = state
          .projects
          .sort((p1: IProject, p2: IProject) => p1.team_id - p2.team_id)
          .map((project: IProject) => {
            return {
              name: `${project.name} (${state.teams.find((team: ITeam) => team.id === project.team_id).name})`,
              value: project.id.toString(),
            } as ChoiceOption;
          });

        return getAutoCompleteChoices(input, projects);
      },
      default: state.projects.findIndex(project => project.id == state.configuration.defaultProjectId),
      validate: (input: string, answers?: Answers) => {
        if (isNullOrUndefined(input)) return "A story must be assigned to a project";
        return true;
      },
    }, {
      type: 'autocomplete',
      name: 'epic',
      message: 'Which epic to assign this story to: ',
      default: state.epics.length,
      source: (answersSoFar: Answers[], input: string) => {
        const epics: ChoiceOption[] = state
          .epics
          .map((epic: IEpic) => ({ name: epic.name, value: epic.id.toString() } as ChoiceOption));

        return getAutoCompleteChoices(input, epics);
      },
    },
    {
      type: 'input',
      name: 'title',
      message: 'Title for this story (short and descriptive): ',
      validate: (input: string, answers?: Answers) => {
        if (isNullOrUndefined(input) || input.length < 5) return "Title should be more than 5 characters long";
        if (input.length > 120) return "Title should not be longer than 120 characters";
        return true;
      },
    },
    {
      type: 'editor',
      name: 'description',
      message: 'A concise description for this story, markdown is supported: ',
      validate: (input: string, answers?: Answers) => {
        if (isNullOrUndefined(input) || input.length < 5) return "Description should be more than 5 characters long";
        return true;
      },
    },
    {
      type: 'list',
      name: 'storyType',
      message: 'What type of work is this: ',
      default: 0,
      choices: ["feature", "bug", "chore"],
    },
    {
      type: 'autocomplete',
      name: 'owner',
      message: 'Which user to assign this story to: ',
      source: (answersSoFar: Answers[], input: string) => {
        const users: ChoiceOption[] = state
          .users
          .map(user => ({ name: user.profile.name, value: user.id } as ChoiceOption));

        users.unshift({ name: "Do not assign", value: null } as ChoiceOption);

        return getAutoCompleteChoices(input, users);
      },
    },
    {
      type: 'autocomplete',
      name: 'labels',
      message: 'Which sprint to put this story in: ',
      default: state.sprints.length,
      source: (answersSoFar: Answers[], input: string) => {
        const labels: ChoiceOption[] = state
          .sprints
          .map((label: ILabel) => ({
            name: label.name,
            value: {
              name: label.name,
            },
          } as ILabelChoice))
          .concat([{ name: "No Label", value: null } as ILabelChoice]);
        return getAutoCompleteChoices(input, labels);
      },
    }] as Question[];

  return inquirer
    .prompt(questions)
    .then((res: any) => {
      return createStory(state.configuration.token, {
        name: res.title,
        description: res.description,
        owner_ids: isNullOrUndefined(res.owner) ? null : [res.owner],
        project_id: parseInt(res.project, 10),
        epic_id: res.epic,
        labels: isNullOrUndefined(res.labels) ? null : [res.labels],
        story_type: res.storyType,
      } as IStory)
        .then((story: IStory) => {
          const id = story.id;
          const storySlug = slug(story.name).toLowerCase();
          const gitCmd = `git checkout -b ${story.story_type}/ch${id}/${storySlug}`;
          console.info(Chalk.green(`Successfully created a story with id ${id}`));
          console.info("You can view your story at " + link(`https://app.clubhouse.io/story/${id}`));
          console.info("To start working on this story (copied to clipboard): " + Chalk.bold(gitCmd));
          writeSync(gitCmd);
          return story;
        })
        .catch((err: any) => {
          console.error(Chalk.red("There was an error processing your request"));
          console.error(err.body);
        });
    });
}

function createTickets(state: IClubhouseState, idx: number = 1) {
  console.info(`\nCreating ticket #${Chalk.bold(idx.toString())}`);
  createSingleTicket(state)
    .then(createdStory => {
      inquirer
        .prompt({
          name: 'doOneMore',
          type: 'confirm',
          message: `Create another ticket: `,
          default: true,
        })
        .then((res: Answers) => {
          if (res.doOneMore) {
            createTickets(state, idx + 1);
          }
        });
    });
}

function getAutoCompleteChoices(input: string, data: ChoiceOption[]) {
  if (isNullOrUndefined(input)) {
    return Promise.resolve(data);
  } else {
    const filtered = data
      .filter((item: ChoiceOption) => item.name.toLowerCase().includes(input.toLowerCase()));
    return Promise.resolve(filtered);
  }
}

function main() {
  const config: IConfiguration = loadConfiguration();
  if (!config.loaded) {
    console.error(Chalk.red(config.errorMsg));
    console.info(Chalk.yellow("You must first configure the CLI"));
    console.info("The most important part is an API token.")
    console.info("To get one, login to your clubhouse account " +
      "and visit " +
      link("https://app.clubhouse.io/settings/account/api-tokens"));

    doInstall(config, { loaded: false } as IClubhouseState).then(getState).then(createTickets);
  } else {
    getState(config).then(createTickets);
  }
}

main();
