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
            .setName('Premium Features')
            .setDesc('Get access to advanced features like two-way sync, title suggestions, and automatic tag creation.')
            .addExtraButton(button => button
                .setIcon('refresh')
                .setTooltip('Check subscription status')
                .onClick(async () => {
                    // TODO: Implement refresh subscription check
                }));
        
        if (!await this.plugin.subscriptionService.isSubscriptionActive()) {
            await this.displayInactiveSubscriber();
        } else {
            await this.displayActiveSubscriber();
            await SubscriptionSettingsTab.displayPremiumFeatures(containerEl, this.plugin);
        }
    }

    static async displayPremiumFeatures(containerEl: HTMLElement, plugin: KeepSidianPlugin): Promise<void> {
        await this.displayPremiumFeaturesLocal(containerEl, plugin, plugin.settings.premiumFeatures);
        await this.displayPremiumFeaturesServer(containerEl, plugin, plugin.settings.premiumFeatures);
    }

    static async displayPremiumFeaturesLocal(containerEl: HTMLElement, plugin: KeepSidianPlugin, premiumFeatureValues: PremiumFeatureSettings): Promise<void> {

        // 3.1 Auto Sync
        new Setting(containerEl)
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
            .setDisabled(!premiumFeatureValues.autoSync);
    }

    static async displayPremiumFeaturesServer(containerEl: HTMLElement, plugin: KeepSidianPlugin, premiumFeatureValues: PremiumFeatureSettings): Promise<void> {
        // 3.2 Filter Notes
        new Setting(containerEl)
            .setName('Only include notes containing')
            .setDesc('Terms to include (comma-separated).')
            .addText(text => text
                .setPlaceholder('term1, term2, ...')
                .setValue(premiumFeatureValues.includeNotesTerms.join(', '))
                .onChange(async (value) => {
                    premiumFeatureValues.includeNotesTerms = value.split(',').map(k => k.trim()).filter(k => k);
                    // TODO: Save settings
                }));

        new Setting(containerEl)
            .setName('Exclude notes containing')
            .setDesc('Terms to skip (comma-separated).')
            .addText(text => text
                .setPlaceholder('term1, term2, ...')
                .setValue(premiumFeatureValues.excludeNotesTerms.join(', '))
                .onChange(async (value) => {
                    premiumFeatureValues.excludeNotesTerms = value.split(',').map(k => k.trim()).filter(k => k);
                    // TODO: Save settings
                }));

        // 3.3 Title Updates
        new Setting(containerEl)
            .setName('Smart Titles')
            .setDesc('Suggest titles based on note content. Original title will be saved in note.')
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.updateTitle)
                .onChange(async (value) => {
                    premiumFeatureValues.updateTitle = value;
                    // TODO: Save settings
                }));

        // 3.4 Tag Suggestions
        new Setting(containerEl)
            .setName('Auto-Tags')
            .setDesc('Generate tags based on note content.')
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.suggestTags)
                .onChange(async (value) => {
                    premiumFeatureValues.suggestTags = value;
                    // TODO: Save settings
                }));

        new Setting(containerEl)
            .setName('Maximum tags')
            .setDesc('Maximum number of tags to generate.')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(premiumFeatureValues.maxTags)
                .onChange(async (value) => {
                    premiumFeatureValues.maxTags = value;
                }))
        .setDisabled(!premiumFeatureValues.suggestTags);

        new Setting(containerEl)
            .setName('Tag prefix')
            .setDesc('Prefix to identify generated tags (leave empty for none).')
            .addText(text => text
                .setValue(premiumFeatureValues.tagPrefix)
                .setPlaceholder('auto-')
                .onChange(async (value) => {
                    premiumFeatureValues.tagPrefix = value;
                    // TODO: Save settings
                }))
            .setDisabled(!premiumFeatureValues.suggestTags);

        new Setting(containerEl)
            .setName('Limit to existing tags')
            .setDesc('Only generate tags that already exist in your vault.')
            .addToggle(toggle => toggle
                .setValue(premiumFeatureValues.limitToExistingTags)
                .onChange(async (value) => {
                    premiumFeatureValues.limitToExistingTags = value;
                    // TODO: Save settings
                }))
            .setDisabled(!premiumFeatureValues.suggestTags);
    }

    private async displayInactiveSubscriber(): Promise<void> {
        const { containerEl } = this;

        containerEl.createEl('h4', { text: 'Why Subscribe?' });

        const benefitsList = containerEl.createEl('ul', { attr: { style: 'font-size: 0.9em' } });
        [
            'Smart Titles: Auto-suggestions from note content.',
            'Auto-Tags: Instant tag generation & management.',
            'Advanced Filters: Sync only what you need.',
            'Priority Support: Your questions answered first.',
            'Two-Way Sync: Keep notes updated, Coming soon.',
            'Early Access: First to get new features.',
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
            .setName('Subscribe Now')
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
            .setName('Subscription Status')
            .setDesc('Active')
            .setClass('subscription-active');

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