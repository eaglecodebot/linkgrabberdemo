// GoLogin 3.0.7's default commitProfile catches upload failures internally.
// Propagate them so its stopAndCommit cannot delete the local profile after
// a failed upload, and the user can retry sync from the panel.
export function useStrictCommit(sdk) {
  sdk.commitProfile = async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const data = await sdk.getProfileDataToUpdate();
    if (!data?.length) throw new Error('Profile archive is empty; local profile retained.');
    await sdk.postFile('profile', data);
  };
}
