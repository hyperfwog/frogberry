/**
 * Action submitter map
 * Ported from Rust crate burberry/src/action_submitter/map.rs
 */

import type { ActionSubmitter, SubmitResult } from '../types';

/**
 * ActionSubmitterMap - maps actions from one type to another
 */
export class ActionSubmitterMap<A1, A2> implements ActionSubmitter<A1> {
  private submitter: ActionSubmitter<A2>;
  private readonly f: (a: A1) => A2 | null | undefined;

  /**
   * Create a new ActionSubmitterMap
   * @param submitter The submitter to delegate to
   * @param f The mapping function
   */
  constructor(submitter: ActionSubmitter<A2>, f: (a: A1) => A2 | null | undefined) {
    this.submitter = submitter;
    this.f = f;
  }

  /**
   * Submit an action
   * @param action The action to submit
   */
  submit(action: A1): void {
    const mappedAction = this.f(action);
    if (mappedAction !== null && mappedAction !== undefined) {
      this.submitter.submit(mappedAction);
    }
  }

  /**
   * Submit an action asynchronously
   * @param action The action to submit
   * @returns A promise that resolves to the result of the submission
   */
  async submitAsync(action: A1): Promise<SubmitResult> {
    const mappedAction = this.f(action);
    if (mappedAction !== null && mappedAction !== undefined) {
      return this.submitter.submitAsync(mappedAction);
    }
    return { success: true };
  }

  /**
   * Try to submit an action
   * @param action The action to submit
   * @returns Whether the action was submitted successfully
   */
  trySubmit(action: A1): boolean {
    const mappedAction = this.f(action);
    if (mappedAction !== null && mappedAction !== undefined && this.submitter.trySubmit) {
      return this.submitter.trySubmit(mappedAction);
    }
    return true;
  }
}
