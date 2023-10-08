import { exec as nativeExec } from "child_process";
import os from "os";
import { mkdir, appendFile, writeFile, access, constants } from "fs/promises";
import path, { join } from "path";
export interface IBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

const levelColor = {
  [LogLevel.DEBUG]: "\x1b[32m[DEBUG`]\x1b[0m", // Green
  [LogLevel.INFO]: "\x1b[33m[INFO]\x1b[0m", // Yellow
  [LogLevel.ERROR]: "\x1b[31m[ERROR]\x1b[0m", // Red
  [LogLevel.WARN]: "\x1b[34m[WARN]\x1b[0m", // Blue
};

export const homedir: () => string = () => {
  return os.homedir();
};

const wmLogFilePath = join(homedir(), ".fyr", "logs", "wm.log");
export const logToFile = async (
  filePath: string,
  message: string,
  level: LogLevel = LogLevel.INFO
): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logMessage = `${levelColor[level]} [${timestamp}] ${message}\n`;

  try {
    // Check if the file exists
    await access(filePath, constants.F_OK);
  } catch (error) {
    // File does not exist, create parent directories if they don't exist
    const dirName = path.dirname(filePath);
    await mkdir(dirName, { recursive: true });
    // Create file with the logMessage
    await writeFile(filePath, logMessage, "utf8");
    return;
  }

  // If the file exists, append the log message
  try {
    await appendFile(filePath, logMessage, "utf8");
  } catch (err) {
    console.error("Failed to write to log file:", err);
  }
};

export const exec: (command: string, callback: (error: any) => void) => void = (
  command,
  callback
) => {
  logToFile(wmLogFilePath, `Running: ${command}`, LogLevel.DEBUG);
  nativeExec(command, (error, stdout, stderr) => {
    if (stdout) {
      logToFile(wmLogFilePath, `Command output: ${stdout}`, LogLevel.DEBUG);
    }

    if (stderr) {
      logToFile(
        wmLogFilePath,
        `Command error output: ${stderr}`,
        LogLevel.ERROR
      );
    }

    if (error) {
      callback(error);
      return;
    }

    // You can also handle `stdout` and `stderr` if needed
  });
};
