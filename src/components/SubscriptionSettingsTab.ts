import { Setting } from "obsidian";
import KeepSidianPlugin from "main";
import { PremiumFeatureSettings } from "types/subscription";
import { KEEPSIDIAN_SERVER_URL } from '../config';

export class SubscriptionSettingsTab {
    private containerEl: HTMLElement;
    private plugin: KeepSidianPlugin;

    constructor(containerEl: HTMLElement, plugin: KeepSidianPlugin) {
        this.containerEl = containerEl;
        this.plugin = plugin;
    }

    async display(): Promise<void> {
        const { containerEl } = this;

        containerEl.createEl('h3', { text: 'Premium Features' });

        // General info about premium features
        new Setting(containerEl)
            .setName('Premium features')
            .setDesc('Get access to advanced features like two-way sync, title suggestions, and automatic tag creation.')
            .addExtraButton(button => button
                .setIcon('refresh')
                .setTooltip('Check subscription status')
                .onClick(async () => {
                    await this.plugin.subscriptionService.checkSubscription();
                    this.display();
                }));

        const isActive = await this.plugin.subscriptionService.isSubscriptionActive();
        await SubscriptionSettingsTab.displayPremiumFeatures(containerEl, this.plugin, isActive);

        if (!isActive) {
            await this.displayInactiveSubscriber();
        } else {
            await this.displayActiveSubscriber();
        }
    }

    static async displayPremiumFeatures(containerEl: HTMLElement, plugin: KeepSidianPlugin, isActive: boolean): Promise<void> {
        await this.displayPremiumFeaturesLocal(containerEl, plugin, plugin.settings.premiumFeatures, isActive);
        await this.displayPremiumFeaturesServer(containerEl, plugin, plugin.settings.premiumFeatures, isActive);
    }

    static async displayPremiumFeaturesLocal(containerEl: HTMLElement, plugin: KeepSidianPlugin, premiumFeatureValues: PremiumFeatureSettings, isActive: boolean): Promise<void> {

        // 3.1 Auto Sync
        // TODO: Implement auto sync
        /* new Setting(containerEl)
            .setName('Auto Sync')
            .setDesc('Automatically sync your notes at regular intervals')
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.autoSync)
                .onChange(async (value) => {
                    premiumFeatureValues.autoSync = value;
                    // TODO: Save settings
                }));

        new Setting(containerEl)
            .setName('Sync Interval')
            .setDesc('How often to sync (in minutes)')
            .addSlider(slider => slider
                .setLimits(5, 120, 5)
                .setValue(premiumFeatureValues.syncIntervalMinutes)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    premiumFeatureValues.syncIntervalMinutes = value;
                    // TODO: Save settings
                }))
            .setDisabled(!premiumFeatureValues.autoSync); */
    }

    static async displayPremiumFeaturesServer(containerEl: HTMLElement, plugin: KeepSidianPlugin, premiumFeatureValues: PremiumFeatureSettings, isActive: boolean): Promise<void> {
        const descSuffix = isActive ? '' : ' (requires a subscription)';

        // 3.2 Filter Notes
        const includeSetting = new Setting(containerEl)
            .setName('Only include notes containing')
            .setDesc('Terms to include (comma-separated).' + descSuffix)
            .addText(text => text
                .setPlaceholder('term1, term2, ...')
                .setValue(premiumFeatureValues.includeNotesTerms.join(', '))
                .onChange(async (value) => {
                    premiumFeatureValues.includeNotesTerms = value.split(',').map(k => k.trim()).filter(k => k);
                    // TODO: Save settings
                }));
        if (!isActive) includeSetting.setClass('requires-subscription');

        const excludeSetting = new Setting(containerEl)
            .setName('Exclude notes containing')
            .setDesc('Terms to skip (comma-separated).' + descSuffix)
            .addText(text => text
                .setPlaceholder('term1, term2, ...')
                .setValue(premiumFeatureValues.excludeNotesTerms.join(', '))
                .onChange(async (value) => {
                    premiumFeatureValues.excludeNotesTerms = value.split(',').map(k => k.trim()).filter(k => k);
                    // TODO: Save settings
                }));
        if (!isActive) excludeSetting.setClass('requires-subscription');

        // 3.3 Title Updates
        const titleSetting = new Setting(containerEl)
            .setName('Smart titles')
            .setDesc('Suggest titles based on note content. Original title will be saved in note.' + descSuffix)
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.updateTitle)
                .onChange(async (value) => {
                    premiumFeatureValues.updateTitle = value;
                    // TODO: Save settings
                }));
        if (!isActive) titleSetting.setClass('requires-subscription');

        // 3.4 Tag Suggestions
        const autoTagSetting = new Setting(containerEl)
            .setName('Auto-tags')
            .setDesc('Generate tags based on note content.' + descSuffix)
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.suggestTags)
                .onChange(async (value) => {
                    premiumFeatureValues.suggestTags = value;
                    // TODO: Save settings
                }));
        if (!isActive) autoTagSetting.setClass('requires-subscription');

        const maxTagsSetting = new Setting(containerEl)
            .setName('Maximum tags')
            .setDesc('Maximum number of tags to generate.' + descSuffix)
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(premiumFeatureValues.maxTags)
                .onChange(async (value) => {
                    premiumFeatureValues.maxTags = value;
                }))
            .setDisabled(!premiumFeatureValues.suggestTags);
        if (!isActive) maxTagsSetting.setClass('requires-subscription');

        const tagPrefixSetting = new Setting(containerEl)
            .setName('Tag prefix')
            .setDesc('Prefix to identify generated tags (leave empty for none).' + descSuffix)
            .addText(text => text
                .setValue(premiumFeatureValues.tagPrefix)
                .setPlaceholder('auto-')
                .onChange(async (value) => {
                    premiumFeatureValues.tagPrefix = value;
                    // TODO: Save settings
                }))
            .setDisabled(!premiumFeatureValues.suggestTags);
        if (!isActive) tagPrefixSetting.setClass('requires-subscription');

        const limitSetting = new Setting(containerEl)
            .setName('Limit to existing tags')
            .setDesc('Only generate tags that already exist in your vault.' + descSuffix)
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.limitToExistingTags)
                .onChange(async (value) => {
                    premiumFeatureValues.limitToExistingTags = value;
                    // TODO: Save settings
                }))
            .setDisabled(!premiumFeatureValues.suggestTags);
        if (!isActive) limitSetting.setClass('requires-subscription');
    }

    private async displayInactiveSubscriber(): Promise<void> {
        const { containerEl } = this;

        containerEl.createEl('h4', { text: 'Why subscribe?' });

        const benefitsList = containerEl.createEl('ul', { attr: { style: 'font-size: 0.9em' } });
        [
            'Smart titles: Auto-suggestions from note content.',
            'Auto-tags: Instant tag generation & management.',
            'Advanced filters: Sync only what you need.',
            'Priority support: Your questions answered first.',
            'Two-way sync: Keep notes updated, Coming soon.',
            'Early access: First to get new features.',
            'And more!'
        ].forEach(benefit => {
            const li = benefitsList.createEl('li');
            const [title, description] = benefit.split(':');
            if (description) {
                li.createSpan({text: title, attr: {style: 'font-weight: bold'}});
                li.createSpan({text: ':' + description});
            } else {
                li.createSpan({text: benefit});
            }
        });

        new Setting(containerEl)
            .setName('Subscribe now')
            .setDesc('Get access to all premium features')
            .addButton(button => button
                .setButtonText('Subscribe')
                .onClick(() => {
                    window.open(`${KEEPSIDIAN_SERVER_URL}/subscribe`, '_blank');
                }));
    }

    private async displayActiveSubscriber(): Promise<void> {
        const { containerEl } = this;
        const subscriptionInfo = await this.plugin.subscriptionService.checkSubscription();

        // Show subscription details
        new Setting(containerEl)
            .setName('✅ Active subscription')
            .setDesc('Your subscription is active. You can configure your premium settings below.');

        if (subscriptionInfo?.plan_details) {
            new Setting(containerEl)
                .setName('Plan')
                .setDesc(subscriptionInfo.plan_details.plan_id);
        }

        if (subscriptionInfo?.metering_info) {
            new Setting(containerEl)
                .setName('Usage')
                .setDesc(`${subscriptionInfo.metering_info.usage} / ${subscriptionInfo.metering_info.limit} notes synced`);
        }
    }
} 